package migrations

import (
	"context"
	"database/sql"
	"strings"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00016_bought_on_datetime.go", up00016, down00016)
}

func up00016(_ context.Context, db *sql.DB) error {
	return backfillBoughtOnMidday(db)
}

func down00016(context.Context, *sql.DB) error {
	return nil
}

func backfillBoughtOnMidday(db *sql.DB) error {
	rows, err := db.Query(`SELECT id, bought_on FROM purchases`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type update struct {
		id int64
		on string
	}
	var updates []update
	for rows.Next() {
		var u update
		if err := rows.Scan(&u.id, &u.on); err != nil {
			return err
		}
		next, ok := withMiddayIfDateOnly(u.on)
		if !ok {
			continue
		}
		u.on = next
		updates = append(updates, u)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, u := range updates {
		if _, err := db.Exec(`UPDATE purchases SET bought_on = ? WHERE id = ?`, u.on, u.id); err != nil {
			return err
		}
	}
	return nil
}

func withMiddayIfDateOnly(s string) (string, bool) {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "T", " ")
	s = strings.ReplaceAll(s, "\u00a0", " ")
	parts := strings.Fields(s)
	if len(parts) != 1 {
		return "", false
	}
	return parts[0] + " 12:00", true
}
