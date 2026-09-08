package mcpserver

import (
	"context"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/adrian/bulkly/internal/store"
)

type Config struct {
	Currency string
}

func New(st *store.Store, cfg Config) *mcp.Server {
	if cfg.Currency == "" {
		cfg.Currency = "PLN"
	}
	server := mcp.NewServer(&mcp.Implementation{Name: "bulkly", Version: "1.0.0"}, nil)
	mcp.AddTool(server, &mcp.Tool{
		Name: "best_price",
		Description: "Find products in the Bulkly purchase log and return the best unit price. " +
			"Uses the lowest unit price from the last 30 days when one exists; otherwise the most recent recorded unit price. " +
			"Catalog names are Polish (plus receipt aliases). Search with the user's words first, then retry with a Polish translation if nothing matches. " +
			"If several products match, return all of them and do not pick one.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in Input) (*mcp.CallToolResult, Output, error) {
		out, err := BestPrice(st, in.Query, time.Now(), cfg.Currency)
		return nil, out, err
	})
	return server
}
