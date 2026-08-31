package ocr

import "errors"

var (
	ErrNotConfigured = errors.New("ocr is not configured")
	ErrNoImage       = errors.New("image is required")
	ErrNotABill      = errors.New("the photo does not look like a bill")
	ErrNoLines       = errors.New("no products found on this bill")
	ErrNoPDFText     = errors.New("this PDF could not be read as images")
	ErrNoModel       = errors.New("ocr model is not set")
)

const DefaultBaseURL = "https://api.openai.com/v1"

type Config struct {
	APIKey  string
	BaseURL string
	Model   string
}

func (c Config) Configured() bool {
	if c.APIKey != "" {
		return true
	}
	base := normalizeBaseURL(c.BaseURL)
	return base != "" && base != DefaultBaseURL
}

type Bill struct {
	BoughtOn  string `json:"bought_on"`
	Notes     string `json:"notes"`
	NotABill  bool   `json:"not_a_bill"`
	CompanyID int64  `json:"company_id,omitempty"`
	Lines     []Line `json:"lines"`
}

type Line struct {
	ReceiptName  string `json:"receipt_name"`
	ProductName  string `json:"product_name"`
	ProductID    int64  `json:"product_id"`
	UnitID       int64  `json:"unit_id"`
	UnitName     string `json:"unit_name"`
	PackageCount string `json:"package_count"`
	PackageSize  string `json:"package_size"`
	Quantity     string `json:"quantity"`
	Amount       string `json:"amount"`
	Skip         bool   `json:"skip"`
	SkipReason   string `json:"skip_reason"`
}

func (b Bill) ProductLines() []Line {
	out := make([]Line, 0, len(b.Lines))
	for _, line := range b.Lines {
		if line.Skip {
			continue
		}
		out = append(out, line)
	}
	return out
}
