package store

import (
	"strings"
	"time"
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
	items, err := s.ListProducts(q)
	if err != nil {
		return nil, err
	}
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	if len(items) == 0 {
		return nil, nil
	}
	ids := make([]int64, len(items))
	for i, it := range items {
		ids[i] = it.ID
	}
	buys, err := listPurchasesForProductIDs(s.q, ids)
	if err != nil {
		return nil, err
	}
	quotes := quotesByProduct(buys, now)
	out := make([]ProductQuote, len(items))
	for i, it := range items {
		out[i] = ProductQuote{Product: it.Product}
		if quote, ok := quotes[it.ID]; ok {
			cp := quote
			out[i].Quote = &cp
		}
	}
	return out, nil
}
