package store

import (
	"database/sql"
	"errors"
	"strings"
)

const (
	RecipePending  = "pending"
	RecipeReady    = "ready"
	RecipeFailed   = "failed"
	RecipeMigrated = "migrated"
)

var (
	ErrRecipeMigrated = errors.New("recipe already migrated")
	ErrRecipeNotReady = errors.New("recipe is not ready to migrate")
)

type Recipe struct {
	ID          int64
	ImagePath   string
	RawResponse string
	Status      string
	CreatedAt   string
}

func (s *Store) CreateRecipe(imagePath string) (Recipe, error) {
	imagePath = strings.TrimSpace(imagePath)
	if imagePath == "" {
		return Recipe{}, errors.New("image is required")
	}
	res, err := s.db.Exec(
		`INSERT INTO recipes (image_path, raw_response, status, created_at) VALUES (?, '', ?, ?)`,
		imagePath, RecipePending, nowRFC3339(),
	)
	if err != nil {
		return Recipe{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Recipe{}, err
	}
	return s.GetRecipe(id)
}

func (s *Store) GetRecipe(id int64) (Recipe, error) {
	var r Recipe
	err := s.db.QueryRow(
		`SELECT id, image_path, raw_response, status, created_at FROM recipes WHERE id = ?`, id,
	).Scan(&r.ID, &r.ImagePath, &r.RawResponse, &r.Status, &r.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Recipe{}, ErrNotFound
	}
	return r, err
}

func (s *Store) SaveAIResponse(id int64, rawJSON string) error {
	res, err := s.db.Exec(
		`UPDATE recipes SET raw_response = ?, status = ? WHERE id = ? AND status IN (?, ?)`,
		rawJSON, RecipeReady, id, RecipePending, RecipeFailed,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		r, getErr := s.GetRecipe(id)
		if getErr != nil {
			return getErr
		}
		if r.Status == RecipeMigrated {
			return ErrRecipeMigrated
		}
		return ErrNotFound
	}
	return nil
}

func (s *Store) FailRecipe(id int64) error {
	res, err := s.db.Exec(
		`UPDATE recipes SET status = ? WHERE id = ? AND status = ?`,
		RecipeFailed, id, RecipePending,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		if _, err := s.GetRecipe(id); err != nil {
			return err
		}
		return ErrNotFound
	}
	return nil
}

func (s *Store) UpdateRecipeJSON(id int64, rawJSON string) error {
	res, err := s.db.Exec(
		`UPDATE recipes SET raw_response = ? WHERE id = ? AND status = ?`,
		rawJSON, id, RecipeReady,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		if _, err := s.GetRecipe(id); err != nil {
			return err
		}
		return ErrRecipeNotReady
	}
	return nil
}

func (s *Store) MigrateRecipe(id int64, in BillImport, rawJSON string) (BillImportResult, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return BillImportResult{}, err
	}
	defer tx.Rollback()

	r, err := getRecipeTx(tx, id)
	if err != nil {
		return BillImportResult{}, err
	}
	if r.Status == RecipeMigrated {
		return BillImportResult{}, ErrRecipeMigrated
	}
	if r.Status != RecipeReady {
		return BillImportResult{}, ErrRecipeNotReady
	}

	in.RecipeID = id
	res, err := importBillTx(tx, in)
	if err != nil {
		return BillImportResult{}, err
	}
	if _, err := tx.Exec(
		`UPDATE recipes SET status = ?, raw_response = ? WHERE id = ?`,
		RecipeMigrated, rawJSON, id,
	); err != nil {
		return BillImportResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return BillImportResult{}, err
	}
	return res, nil
}

func getRecipeTx(tx *sql.Tx, id int64) (Recipe, error) {
	var r Recipe
	err := tx.QueryRow(
		`SELECT id, image_path, raw_response, status, created_at FROM recipes WHERE id = ?`, id,
	).Scan(&r.ID, &r.ImagePath, &r.RawResponse, &r.Status, &r.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Recipe{}, ErrNotFound
	}
	return r, err
}
