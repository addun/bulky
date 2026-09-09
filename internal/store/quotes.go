package store

import (
	"strings"
	"time"

	"github.com/adrian/bulkly/internal/store/sqlc"
)

type ProductQuote struct {
	Product Product
	Quote   *QuotedPrice
}

func (s *Store) SearchProductQuotes(q string, now time.Time, limit int) ([]ProductQuote, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return nil, nil
	}
	items, err := s.listProducts(q, now, limit)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, nil
	}
	out := make([]ProductQuote, len(items))
	for i, it := range items {
		out[i] = ProductQuote{Product: it.Product, Quote: it.Quote}
	}
	return out, nil
}

func attachProductQuotes(q *sqlc.Queries, items []ProductListItem, now time.Time) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]int64, len(items))
	for i, it := range items {
		ids[i] = it.ID
	}
	buys, err := listPurchasesForProductIDs(q, ids)
	if err != nil {
		return err
	}
	quotes := quotesByProduct(buys, now)
	for i := range items {
		if quote, ok := quotes[items[i].ID]; ok {
			cp := quote
			items[i].Quote = &cp
		}
	}
	return nil
}
