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

func Parse(raw []byte) (Bill, error) {
	return parseBill(raw)
}

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
	bill.StoryName = strings.TrimSpace(bill.StoryName)
	bill.ExternalID = strings.TrimSpace(bill.ExternalID)
	bill.StreetName = stripStreetPrefix(bill.StreetName)
	bill.BuildingNumber = strings.TrimSpace(bill.BuildingNumber)
	bill.ApartmentNumber = strings.TrimSpace(bill.ApartmentNumber)
	bill.PostalCode = normalizePostal(bill.PostalCode)
	bill.City = strings.TrimSpace(bill.City)
	bill.BoughtOn, bill.BoughtAt = splitDateAndTime(bill.BoughtOn, bill.BoughtAt)
	bill.BoughtOn = normalizeDate(bill.BoughtOn)
	bill.BoughtAt = normalizeTime(bill.BoughtAt)
	for i := range bill.Lines {
		normalizeLine(&bill.Lines[i])
		fixWeighedKg(&bill.Lines[i])
		fillMissingAmount(&bill.Lines[i])
	}
	return bill, nil
}

func normalizeLine(line *Line) {
	line.ReceiptName = strings.TrimSpace(line.ReceiptName)
	line.ProductName = strings.TrimSpace(line.ProductName)
	if line.ProductName == "" {
		line.ProductName = line.ReceiptName
	}
	line.UnitName = strings.TrimSpace(line.UnitName)
	line.SkipReason = strings.TrimSpace(line.SkipReason)

	unitPrice, vatFromPrice := peelVAT(line.UnitPrice)
	amount, vatFromAmount := peelVAT(line.Amount)
	count, vatFromCount := peelVAT(line.PackageCount)
	line.UnitPrice = normalizeNumber(unitPrice)
	line.Amount = normalizeNumber(amount)
	line.PackageCount = normalizeNumber(count)
	line.PackageSize = normalizeNumber(line.PackageSize)
	line.Quantity = normalizeNumber(line.Quantity)
	line.Discount = normalizeDiscount(line.Discount)
	line.VatType = normalizeVAT(line.VatType, vatFromPrice, vatFromAmount, vatFromCount)
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

func splitDateAndTime(date, clock string) (string, string) {
	date = strings.TrimSpace(date)
	clock = strings.TrimSpace(clock)
	date = strings.ReplaceAll(date, "\u00a0", " ")
	date = strings.ReplaceAll(date, "T", " ")
	parts := strings.Fields(date)
	if len(parts) == 0 {
		return date, clock
	}
	date = parts[0]
	if clock == "" && len(parts) >= 2 {
		clock = parts[1]
	}
	return date, clock
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

func normalizeTime(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	s = strings.ReplaceAll(s, "\u00a0", " ")
	s = strings.ReplaceAll(s, ".", ":")
	if i := strings.IndexByte(s, ' '); i >= 0 {
		s = s[:i]
	}
	for _, layout := range []string{"15:04:05", "15:04", "15:04:05Z07:00"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Format("15:04")
		}
	}
	return s
}

func normalizePostal(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var digits strings.Builder
	for _, r := range s {
		if unicode.IsDigit(r) {
			digits.WriteRune(r)
		}
	}
	d := digits.String()
	if len(d) == 5 {
		return d[:2] + "-" + d[2:]
	}
	return s
}

func stripStreetPrefix(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	lower := strings.ToLower(s)
	for _, p := range []string{"ulica ", "ul. ", "ul ", "aleje ", "aleja ", "al. ", "al ", "plac ", "pl. ", "pl "} {
		if strings.HasPrefix(lower, p) {
			return strings.TrimSpace(s[len(p):])
		}
	}
	return s
}

func peelVAT(s string) (num, vat string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", ""
	}
	runes := []rune(s)
	last := unicode.ToUpper(runes[len(runes)-1])
	if last == 'A' || last == 'B' || last == 'C' {
		return strings.TrimSpace(string(runes[:len(runes)-1])), string(last)
	}
	return s, ""
}

func normalizeVAT(values ...string) string {
	for _, s := range values {
		s = strings.ToUpper(strings.TrimSpace(s))
		if s == "" {
			continue
		}
		s = strings.TrimRightFunc(s, func(r rune) bool {
			return unicode.IsDigit(r) || r == '%' || unicode.IsSpace(r)
		})
		s = strings.TrimSpace(s)
		if s == "A" || s == "B" || s == "C" {
			return s
		}
		if r := []rune(s); len(r) > 0 {
			last := unicode.ToUpper(r[len(r)-1])
			if last == 'A' || last == 'B' || last == 'C' {
				return string(last)
			}
		}
	}
	return ""
}

func normalizeDiscount(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "−")
	s = strings.TrimPrefix(s, "–")
	s = strings.TrimPrefix(s, "-")
	s = normalizeNumber(s)
	if s == "" {
		return ""
	}
	d, err := decimal.NewFromString(s)
	if err != nil {
		return s
	}
	return d.Abs().StringFixed(2)
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

// fillMissingAmount sets amount from printed unit price, qty, and rabat
// when the till did not print a final line total. Never overwrites a
// printed amount.
func fillMissingAmount(line *Line) {
	if line.Skip || strings.TrimSpace(line.Amount) != "" {
		return
	}
	price, err := decimal.NewFromString(line.UnitPrice)
	if err != nil || price.IsZero() {
		return
	}
	count, err := decimal.NewFromString(line.PackageCount)
	if err != nil || count.IsZero() {
		return
	}
	discount := decimal.Zero
	if line.Discount != "" {
		d, err := decimal.NewFromString(line.Discount)
		if err == nil {
			discount = d.Abs()
		}
	}
	line.Amount = count.Mul(price).Sub(discount).Round(2).StringFixed(2)
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
	BoughtOn        string    `json:"bought_on"`
	BoughtAt        string    `json:"bought_at"`
	Notes           string    `json:"notes"`
	NotABill        bool      `json:"not_a_bill"`
	StoryID         flexInt   `json:"company_id"`
	StoryName       string    `json:"company_name"`
	ExternalID      string    `json:"external_id"`
	StreetName      string    `json:"street_name"`
	BuildingNumber  string    `json:"building_number"`
	ApartmentNumber string    `json:"apartment_number"`
	PostalCode      string    `json:"postal_code"`
	City            string    `json:"city"`
	Lines           []rawLine `json:"lines"`
}

type rawLine struct {
	ReceiptName  string  `json:"receipt_name"`
	ProductName  string  `json:"product_name"`
	ProductID    flexInt `json:"product_id"`
	UnitID       flexInt `json:"unit_id"`
	UnitName     string  `json:"unit_name"`
	VatType      string  `json:"vat_type"`
	PackageCount flexNum `json:"package_count"`
	PackageSize  flexNum `json:"package_size"`
	Quantity     flexNum `json:"quantity"`
	UnitPrice    flexNum `json:"unit_price"`
	Discount     flexNum `json:"discount"`
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
	b.BoughtAt = raw.BoughtAt
	b.Notes = raw.Notes
	b.NotABill = raw.NotABill
	b.StoryID = int64(raw.StoryID)
	b.StoryName = raw.StoryName
	b.ExternalID = raw.ExternalID
	b.StreetName = raw.StreetName
	b.BuildingNumber = raw.BuildingNumber
	b.ApartmentNumber = raw.ApartmentNumber
	b.PostalCode = raw.PostalCode
	b.City = raw.City
	b.Lines = make([]Line, len(raw.Lines))
	for i, line := range raw.Lines {
		b.Lines[i] = Line{
			ReceiptName:  line.ReceiptName,
			ProductName:  line.ProductName,
			ProductID:    int64(line.ProductID),
			UnitID:       int64(line.UnitID),
			UnitName:     line.UnitName,
			VatType:      line.VatType,
			PackageCount: string(line.PackageCount),
			PackageSize:  string(line.PackageSize),
			Quantity:     string(line.Quantity),
			UnitPrice:    string(line.UnitPrice),
			Discount:     string(line.Discount),
			Amount:       string(line.Amount),
			Skip:         line.Skip,
			SkipReason:   line.SkipReason,
		}
	}
	return nil
}
