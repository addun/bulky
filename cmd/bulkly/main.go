package main

import (
	"log"
	"net/http"
	"os"

	"github.com/adrian/bulkly/internal/store"
	"github.com/adrian/bulkly/internal/web"
)

func main() {
	dataDir := getenv("DATA_DIR", "./data")
	addr := getenv("ADDR", ":8080")

	st, err := store.Open(dataDir)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	srv, err := web.New(st, web.Config{
		Currency:       getenv("CURRENCY", "PLN"),
		CurrencySymbol: getenv("CURRENCY_SYMBOL", "zł"),
	})
	if err != nil {
		log.Fatalf("web: %v", err)
	}

	log.Printf("bulkly listening on %s (data %s)", addr, dataDir)
	if err := http.ListenAndServe(addr, srv.Handler()); err != nil {
		log.Fatal(err)
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
