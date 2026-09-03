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
	Companies         int
	Products          int
	HistoryPerProduct int
}

type fakeStats struct {
	Companies int
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
	companies := make([]store.Company, 0, cfg.Companies)
	for i := 0; i < cfg.Companies; i++ {
		apt := ""
		if f.Bool() {
			apt = f.DigitN(2)
		}
		c, err := st.CreateCompany(
			f.Company(),
			f.StreetName(),
			f.StreetNumber(),
			apt,
			fmt.Sprintf("%s-%s", f.DigitN(2), f.DigitN(3)),
			f.City(),
		)
		if err != nil {
			return stats, fmt.Errorf("company: %w", err)
		}
		companies = append(companies, c)
		stats.Companies++
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
				var companyID int64
				if len(companies) > 0 && f.Number(1, 100) <= 80 {
					companyID = companies[f.IntN(len(companies))].ID
				}
				jitter := time.Duration(f.Number(0, 36)) * time.Hour
				when := start
				if cfg.HistoryPerProduct > 1 {
					when = start.Add(time.Duration(n) * span / time.Duration(cfg.HistoryPerProduct-1))
				}
				boughtOn := when.Add(jitter).Format("2006-01-02")
				price = clampUnitPrice(price * f.Float64Range(0.93, 1.08))
				packs := decimal.NewFromInt(int64(f.Number(1, 8)))
				packSize := packSizeFor(f, p.UnitName)
				if f.Number(1, 100) <= 25 {
					packs = decimal.NewFromInt(1)
					packSize = looseQty(f, p.UnitName)
				}
				qty := packs.Mul(packSize)
				amount := decimal.NewFromFloat(price).Mul(qty).Round(2)

				if _, err := st.CreatePurchase(p.ID, companyID, boughtOn, decimal.Zero, amount, kind, packs, packSize); err != nil {
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
			pt.row.CompanyID,
			pt.row.BoughtOn,
			decimal.Zero,
			amount,
			pt.row.Kind,
			pt.row.FormPackages(),
			pt.row.FormPackSize(),
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

func packSizeFor(f *gofakeit.Faker, unit string) decimal.Decimal {
	if strings.EqualFold(unit, "kg") {
		return decimal.RequireFromString(f.RandomString([]string{"0.25", "0.5", "1", "2.5", "5", "10"}))
	}
	return decimal.RequireFromString(f.RandomString([]string{"50", "100", "250", "500", "1000"}))
}

func looseQty(f *gofakeit.Faker, unit string) decimal.Decimal {
	if strings.EqualFold(unit, "kg") {
		return decimal.NewFromFloat(f.Float64Range(0.4, 12)).Round(3)
	}
	return decimal.NewFromInt(int64(f.Number(80, 2500)))
}
