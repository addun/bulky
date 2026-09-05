package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/adrian/bulkly/internal/store"
	"github.com/brianvoe/gofakeit/v7"
	"github.com/shopspring/decimal"
)

const (
	minUnitPrice = 1.0
	maxUnitPrice = 100.0
)

type fakeConfig struct {
	Stories           int
	Products          int
	HistoryPerProduct int
}

type fakeStats struct {
	Stories   int
	Products  int
	Purchases int
}

func fakeSeed(st *store.Store, f *gofakeit.Faker, cfg fakeConfig) (fakeStats, error) {
	units, err := st.ListUnits()
	if err != nil {
		return fakeStats{}, err
	}
	if len(units) == 0 {
		return fakeStats{}, fmt.Errorf("no units in the database")
	}

	var stats fakeStats
	chains := make([]store.RetailChain, 0, 3)
	if cfg.Stories > 0 {
		for i := 0; i < 3; i++ {
			name := fmt.Sprintf("%s %d", f.Company(), i+1)
			c, err := st.CreateRetailChain(name, name+" Sp. z o.o.", f.DigitN(10))
			if err != nil {
				return stats, fmt.Errorf("retail chain: %w", err)
			}
			chains = append(chains, c)
		}
	}
	stories := make([]store.Story, 0, cfg.Stories)
	for i := 0; i < cfg.Stories; i++ {
		apt := ""
		if f.Bool() {
			apt = f.DigitN(2)
		}
		var chainID int64
		if len(chains) > 0 && f.Number(1, 100) <= 80 {
			chainID = chains[f.IntN(len(chains))].ID
		}
		c, err := st.CreateStory(
			f.Company(),
			f.StreetName(),
			f.StreetNumber(),
			apt,
			fmt.Sprintf("%s-%s", f.DigitN(2), f.DigitN(3)),
			f.City(),
			"",
			chainID,
		)
		if err != nil {
			return stats, fmt.Errorf("story: %w", err)
		}
		stories = append(stories, c)
		stats.Stories++
	}

	seen := map[string]bool{}
	products := make([]store.Product, 0, cfg.Products)
	for len(products) < cfg.Products {
		name := productName(f)
		key := strings.ToLower(name)
		if seen[key] {
			name = fmt.Sprintf("%s %s %d", name, f.Color(), len(products)+1)
			key = strings.ToLower(name)
			if seen[key] {
				continue
			}
		}
		seen[key] = true
		unit := units[f.IntN(len(units))]
		p, err := st.CreateProduct(name, unit.ID, nil)
		if err != nil {
			return stats, fmt.Errorf("product: %w", err)
		}
		products = append(products, p)
		stats.Products++
	}

	start := time.Now().AddDate(-2, 0, 0)
	end := time.Now()
	span := end.Sub(start)
	err = st.ImmediateTx(func() error {
		for _, p := range products {
			price := f.Float64Range(minUnitPrice, maxUnitPrice)
			for n := 0; n < cfg.HistoryPerProduct; n++ {
				kind := store.KindPurchase
				if f.Number(1, 100) <= 12 {
					kind = store.KindPrice
				}
				var storyID int64
				if len(stories) > 0 && f.Number(1, 100) <= 80 {
					storyID = stories[f.IntN(len(stories))].ID
				}
				jitter := time.Duration(f.Number(0, 36)) * time.Hour
				when := start
				if cfg.HistoryPerProduct > 1 {
					when = start.Add(time.Duration(n) * span / time.Duration(cfg.HistoryPerProduct-1))
				}
				boughtOn := when.Add(jitter).Format("2006-01-02")
				price = clampUnitPrice(price * f.Float64Range(0.93, 1.08))
				qty := decimal.NewFromInt(int64(f.Number(1, 8)))
				if strings.EqualFold(p.UnitName, "kg") {
					qty = decimal.NewFromFloat(f.Float64Range(0.4, 12)).Round(3)
				}
				amount := decimal.NewFromFloat(price).Mul(qty).Round(2)

				if _, err := st.CreatePurchase(p.ID, storyID, boughtOn, qty, amount, kind); err != nil {
					return fmt.Errorf("purchase: %w", err)
				}
				stats.Purchases++
			}
		}
		return nil
	})
	if err != nil {
		return stats, err
	}
	return stats, nil
}

func clampUnitPrice(p float64) float64 {
	if p < minUnitPrice {
		return minUnitPrice
	}
	if p > maxUnitPrice {
		return maxUnitPrice
	}
	return p
}

// clampExistingUnitPrices rescales each product whose unit prices fall
// outside 1–100 zł so the series sits in that range and keeps its shape.
func clampExistingUnitPrices(st *store.Store) (int, error) {
	products, err := st.ListProducts("")
	if err != nil {
		return 0, err
	}
	var updated int
	err = st.ImmediateTx(func() error {
		for _, p := range products {
			rows, err := st.ListPurchases(p.ID)
			if err != nil {
				return err
			}
			n, err := rescalePurchases(st, rows)
			if err != nil {
				return err
			}
			updated += n
		}
		return nil
	})
	return updated, err
}

func rescalePurchases(st *store.Store, rows []store.Purchase) (int, error) {
	type priced struct {
		row   store.Purchase
		price decimal.Decimal
	}
	var pts []priced
	lo, hi := decimal.Zero, decimal.Zero
	for _, row := range rows {
		if row.Quantity.IsZero() {
			continue
		}
		price := row.Amount.Div(row.Quantity)
		if len(pts) == 0 || price.LessThan(lo) {
			lo = price
		}
		if len(pts) == 0 || price.GreaterThan(hi) {
			hi = price
		}
		pts = append(pts, priced{row: row, price: price})
	}
	minP := decimal.NewFromFloat(minUnitPrice)
	maxP := decimal.NewFromFloat(maxUnitPrice)
	if len(pts) == 0 || (!lo.LessThan(minP) && !hi.GreaterThan(maxP)) {
		return 0, nil
	}
	span := hi.Sub(lo)
	mid := minP.Add(maxP).Div(decimal.NewFromInt(2))
	var n int
	for _, pt := range pts {
		var newPrice decimal.Decimal
		if span.IsZero() {
			newPrice = mid
		} else {
			t := pt.price.Sub(lo).Div(span)
			newPrice = minP.Add(t.Mul(maxP.Sub(minP)))
		}
		amount := newPrice.Mul(pt.row.Quantity).Round(2)
		if err := st.UpdatePurchase(
			pt.row.ID,
			pt.row.StoryID,
			pt.row.BoughtOn,
			pt.row.Quantity,
			amount,
			pt.row.Kind,
		); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func productName(f *gofakeit.Faker) string {
	base := f.RandomString([]string{
		f.Fruit(),
		f.Vegetable(),
		"Rice",
		"Rolled oats",
		"Wheat flour",
		"Almonds",
		"Cashews",
		"Chickpeas",
		"Red lentils",
		"Coffee beans",
		"Cocoa nibs",
		"Quinoa",
		"Buckwheat",
		"Sunflower seeds",
		"Pumpkin seeds",
		"Coconut flakes",
		"Brown sugar",
		"Sea salt",
	})
	if f.Bool() {
		return strings.TrimSpace(f.Adjective() + " " + base)
	}
	return base
}
