package store

import (
	"database/sql"
	"embed"

	_ "github.com/adrian/bulkly/internal/store/migrations"
	"github.com/pressly/goose/v3"
)

//go:embed migrations
var embedMigrations embed.FS

func runMigrations(db *sql.DB) error {
	goose.SetBaseFS(embedMigrations)
	if err := goose.SetDialect("sqlite3"); err != nil {
		return err
	}
	return goose.Up(db, "migrations")
}
