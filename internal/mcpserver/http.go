package mcpserver

import (
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/adrian/bulkly/internal/store"
)

// Handler serves MCP over Streamable HTTP with no authentication.
func Handler(st *store.Store, cfg Config) http.Handler {
	server := New(st, cfg)
	return mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return server
	}, &mcp.StreamableHTTPOptions{
		Stateless:                  true,
		JSONResponse:               true,
		DisableLocalhostProtection: true,
	})
}
