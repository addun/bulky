package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationNoTxContext("00005_rename_recipes.go", up00005, down00005)
}

func up00005(_ context.Context, db *sql.DB) error {
	if err := renameRecipesTable(db); err != nil {
		return err
	}
	return renamePurchaseRecipeColumn(db)
}

func down00005(context.Context, *sql.DB) error {
	return nil
}

func renameRecipesTable(db *sql.DB) error {
	hasRecipes, err := hasTable(db, "recipes")
	if err != nil || !hasRecipes {
		return err
	}
	hasReceipts, err := hasTable(db, "receipts")
	if err != nil || hasReceipts {
		return err
	}
	if _, err := db.Exec(`DROP INDEX IF EXISTS idx_recipes_status`); err != nil {
		return err
	}
	if _, err := db.Exec(`ALTER TABLE recipes RENAME TO receipts`); err != nil {
		return err
	}
	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status)`)
	return err
}

func renamePurchaseRecipeColumn(db *sql.DB) error {
	hasOld, err := hasColumn(db, "purchases", "recipe_id")
	if err != nil || !hasOld {
		return err
	}
	hasNew, err := hasColumn(db, "purchases", "receipt_id")
	if err != nil || hasNew {
		return err
	}
	if _, err := db.Exec(`DROP INDEX IF EXISTS idx_purchases_recipe`); err != nil {
		return err
	}
	if _, err := db.Exec(`ALTER TABLE purchases RENAME COLUMN recipe_id TO receipt_id`); err != nil {
		return err
	}
	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_purchases_receipt ON purchases(receipt_id)`)
	return err
}
