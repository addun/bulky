package mcpserver

import (
	"fmt"
	"strings"
	"time"

	"github.com/adrian/bulkly/internal/store"
)

const matchLimit = 10

const noMatchHint = "No catalog match. Catalog names are Polish; retry with a translation (for example bananas → banany)."

type Input struct {
	Query string `json:"query" jsonschema:"Product name as the user said it. Catalog names are Polish; if nothing matches, retry with a Polish translation."`
}

type Match struct {
	ID       int64  `json:"id" jsonschema:"Catalog product id"`
	Name     string `json:"name" jsonschema:"Catalog product name"`
	Unit     string `json:"unit" jsonschema:"Catalog unit, for example kg"`
	Price    string `json:"price,omitempty" jsonschema:"Unit price as a decimal string"`
	BoughtOn string `json:"bought_on,omitempty" jsonschema:"Purchase date YYYY-MM-DD"`
	Window   string `json:"window,omitempty" jsonschema:"last_30_days when a purchase exists in the last 30 days, otherwise last_record"`
	Currency string `json:"currency,omitempty" jsonschema:"ISO currency code"`
}

type Output struct {
	Query   string  `json:"query"`
	Matches []Match `json:"matches"`
	Hint    string  `json:"hint,omitempty" jsonschema:"Set when nothing matched, so the agent can retry in Polish"`
}

func BestPrice(st *store.Store, query string, now time.Time, currency string) (Output, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return Output{}, fmt.Errorf("query is required")
	}
	if currency == "" {
		currency = "PLN"
	}
	quotes, err := st.SearchProductQuotes(query, now, matchLimit)
	if err != nil {
		return Output{}, err
	}
	out := Output{Query: query, Matches: make([]Match, 0, len(quotes))}
	for _, q := range quotes {
		m := Match{ID: q.Product.ID, Name: q.Product.Name, Unit: q.Product.UnitName}
		if q.Quote != nil {
			m.Price = q.Quote.Price.String()
			m.BoughtOn = store.BoughtOnDate(q.Quote.BoughtOn)
			m.Window = q.Quote.Window
			m.Currency = currency
		}
		out.Matches = append(out.Matches, m)
	}
	if len(out.Matches) == 0 {
		out.Hint = noMatchHint
	}
	return out, nil
}
