package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/adrian/bulkly/internal/store"
	"github.com/brianvoe/gofakeit/v7"
	"github.com/shopspring/decimal"
)

type fakeConfig struct {
	Companies int
	Products  int
	Purchases int
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
			name = name + " " + f.Color()
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

	start := time.Now().AddDate(-3, 0, 0)
	end := time.Now()
	for i := 0; i < cfg.Purchases; i++ {
		p := products[f.IntN(len(products))]
		kind := store.KindPurchase
		if f.Number(1, 100) <= 12 {
			kind = store.KindPrice
		}
		var companyID int64
		if len(companies) > 0 && f.Number(1, 100) <= 80 {
			companyID = companies[f.IntN(len(companies))].ID
		}
		boughtOn := f.DateRange(start, end).Format("2006-01-02")
		amount := decimal.NewFromFloat(f.Float64Range(3.5, 220)).Round(2)
		packs := decimal.NewFromInt(int64(f.Number(1, 8)))
		packSize := packSizeFor(f, p.UnitName)
		if f.Number(1, 100) <= 25 {
			packs = decimal.NewFromInt(1)
			packSize = looseQty(f, p.UnitName)
		}

		if _, err := st.CreatePurchase(p.ID, companyID, boughtOn, decimal.Zero, amount, kind, packs, packSize); err != nil {
			return stats, fmt.Errorf("purchase: %w", err)
		}
		stats.Purchases++
	}
	return stats, nil
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
