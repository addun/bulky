package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00013_alias_scopes.go", up00013, down00013)
}

func up00013(_ context.Context, db *sql.DB) error {
	has, err := hasColumn(db, "product_aliases", "retail_chain_id")
	if err != nil {
		return err
	}
	if !has {
		if err := rebuildProductAliasesWithChain(db); err != nil {
			return err
		}
	}
	return ensureAliasScopeIndexes(db)
}

func down00013(context.Context, *sql.DB) error {
	return nil
}

func rebuildProductAliasesWithChain(db *sql.DB) error {
	if _, err := db.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	defer db.Exec(`PRAGMA foreign_keys = ON`)
	if _, err := db.Exec(`
CREATE TABLE product_aliases_new (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE,
  retail_chain_id INTEGER REFERENCES retail_chains(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  CHECK (NOT (story_id IS NOT NULL AND retail_chain_id IS NOT NULL))
)`); err != nil {
		return err
	}
	if _, err := db.Exec(`
INSERT INTO product_aliases_new (id, product_id, story_id, retail_chain_id, alias)
SELECT id, product_id, story_id, NULL, alias FROM product_aliases`); err != nil {
		return err
	}
	if _, err := db.Exec(`DROP TABLE product_aliases`); err != nil {
		return err
	}
	_, err := db.Exec(`ALTER TABLE product_aliases_new RENAME TO product_aliases`)
	return err
}

func ensureAliasScopeIndexes(db *sql.DB) error {
	if _, err := db.Exec(`DROP INDEX IF EXISTS idx_product_aliases_global`); err != nil {
		return err
	}
	if _, err := db.Exec(`DROP INDEX IF EXISTS idx_product_aliases_shop`); err != nil {
		return err
	}
	if _, err := db.Exec(`DROP INDEX IF EXISTS idx_product_aliases_chain`); err != nil {
		return err
	}
	if _, err := db.Exec(`DROP INDEX IF EXISTS idx_product_aliases_product`); err != nil {
		return err
	}
	if _, err := db.Exec(`
CREATE UNIQUE INDEX idx_product_aliases_shop
  ON product_aliases(story_id, alias COLLATE NOCASE)
  WHERE story_id IS NOT NULL`); err != nil {
		return err
	}
	if _, err := db.Exec(`
CREATE UNIQUE INDEX idx_product_aliases_chain
  ON product_aliases(retail_chain_id, alias COLLATE NOCASE)
  WHERE retail_chain_id IS NOT NULL`); err != nil {
		return err
	}
	if _, err := db.Exec(`
CREATE UNIQUE INDEX idx_product_aliases_global
  ON product_aliases(alias COLLATE NOCASE)
  WHERE story_id IS NULL AND retail_chain_id IS NULL`); err != nil {
		return err
	}
	_, err := db.Exec(`CREATE INDEX idx_product_aliases_product ON product_aliases(product_id)`)
	return err
}
