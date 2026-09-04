package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00011_rename_companies.go", up00011, down00011)
}

func up00011(_ context.Context, db *sql.DB) error {
	if err := renameCompaniesTable(db); err != nil {
		return err
	}
	if err := renamePurchaseCompanyColumn(db); err != nil {
		return err
	}
	return renameAliasCompanyColumn(db)
}

func down00011(context.Context, *sql.DB) error {
	return nil
}

func renameCompaniesTable(db *sql.DB) error {
	hasOld, err := hasTable(db, "companies")
	if err != nil || !hasOld {
		return err
	}
	hasNew, err := hasTable(db, "stories")
	if err != nil || hasNew {
		return err
	}
	if _, err := db.Exec(`DROP INDEX IF EXISTS idx_companies_name`); err != nil {
		return err
	}
	if _, err := db.Exec(`ALTER TABLE companies RENAME TO stories`); err != nil {
		return err
	}
	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_stories_name ON stories(name COLLATE NOCASE)`)
	return err
}

func renamePurchaseCompanyColumn(db *sql.DB) error {
	hasOld, err := hasColumn(db, "purchases", "company_id")
	if err != nil || !hasOld {
		return err
	}
	hasNew, err := hasColumn(db, "purchases", "story_id")
	if err != nil || hasNew {
		return err
	}
	if _, err := db.Exec(`DROP INDEX IF EXISTS idx_purchases_company`); err != nil {
		return err
	}
	if _, err := db.Exec(`ALTER TABLE purchases RENAME COLUMN company_id TO story_id`); err != nil {
		return err
	}
	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_purchases_story ON purchases(story_id)`)
	return err
}

func renameAliasCompanyColumn(db *sql.DB) error {
	hasOld, err := hasColumn(db, "product_aliases", "company_id")
	if err != nil || !hasOld {
		return err
	}
	hasNew, err := hasColumn(db, "product_aliases", "story_id")
	if err != nil || hasNew {
		return err
	}
	if _, err := db.Exec(`DROP INDEX IF EXISTS idx_product_aliases_shop`); err != nil {
		return err
	}
	if _, err := db.Exec(`DROP INDEX IF EXISTS idx_product_aliases_global`); err != nil {
		return err
	}
	if _, err := db.Exec(`ALTER TABLE product_aliases RENAME COLUMN company_id TO story_id`); err != nil {
		return err
	}
	if _, err := db.Exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_aliases_shop
  ON product_aliases(story_id, alias COLLATE NOCASE)
  WHERE story_id IS NOT NULL`); err != nil {
		return err
	}
	_, err = db.Exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_aliases_global
  ON product_aliases(alias COLLATE NOCASE)
  WHERE story_id IS NULL`)
	return err
}
