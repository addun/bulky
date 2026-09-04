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
	stories := flag.Int("stories", 16, "fake stores to insert")
	products := flag.Int("products", 100, "fake products to insert")
	history := flag.Int("history-per-product", 250, "fake purchases and prices per product")
	clampOnly := flag.Bool("clamp-prices", false, "rescale existing unit prices into 1–100 zł without inserting")
	flag.Parse()

	st, err := store.Open(*dataDir)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	if *clampOnly {
		n, err := clampExistingUnitPrices(st)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Printf("rescaled %d purchases into 1–100 zł in %s\n", n, *dataDir)
		return
	}

	if *stories < 0 || *products < 1 || *history < 0 {
		log.Fatal("need at least 1 product; stores and history-per-product must be >= 0")
	}

	usedSeed := *seed
	if usedSeed == 0 {
		usedSeed = gofakeit.Uint64()
	}
	fmt.Printf("gofakeit seed: %d\n", usedSeed)

	stats, err := fakeSeed(st, gofakeit.New(usedSeed), fakeConfig{
		Stories:           *stories,
		Products:          *products,
		HistoryPerProduct: *history,
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("inserted %d stores, %d products, %d purchases into %s\n", stats.Stories, stats.Products, stats.Purchases, *dataDir)
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
