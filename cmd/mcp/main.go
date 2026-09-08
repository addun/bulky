package main

import (
	"context"
	"log"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/adrian/bulkly/internal/mcpserver"
	"github.com/adrian/bulkly/internal/store"
)

func main() {
	log.SetOutput(os.Stderr)
	dataDir := getenv("DATA_DIR", "./data")

	st, err := store.Open(dataDir)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	server := mcpserver.New(st, mcpserver.Config{
		Currency: getenv("CURRENCY", "PLN"),
	})
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatal(err)
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
