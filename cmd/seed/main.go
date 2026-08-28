package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/adrian/bulkly/internal/store"
	"github.com/brianvoe/gofakeit/v7"
)

func main() {
	dataDir := flag.String("data-dir", getenv("DATA_DIR", "./data"), "SQLite directory (same as cmd/bulkly)")
	seed := flag.Uint64("seed", 0, "gofakeit seed; 0 picks a random one and prints it")
	companies := flag.Int("companies", 8, "fake companies to insert")
	products := flag.Int("products", 24, "fake products to insert")
	purchases := flag.Int("purchases", 80, "fake purchases and prices to insert")
	flag.Parse()

	if *companies < 0 || *products < 1 || *purchases < 0 {
		log.Fatal("need at least 1 product; companies and purchases must be >= 0")
	}

	usedSeed := *seed
	if usedSeed == 0 {
		usedSeed = gofakeit.Uint64()
	}
	fmt.Printf("gofakeit seed: %d\n", usedSeed)

	st, err := store.Open(*dataDir)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	stats, err := fakeSeed(st, gofakeit.New(usedSeed), fakeConfig{
		Companies: *companies,
		Products:  *products,
		Purchases: *purchases,
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("inserted %d companies, %d products, %d purchases into %s\n", stats.Companies, stats.Products, stats.Purchases, *dataDir)
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
