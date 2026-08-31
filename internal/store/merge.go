package store

import (
	"database/sql"
	"errors"
	"strings"
)

type MergePlan struct {
	Into        Product
	From        Product
	History     int
	Aliases     int
	NameAsAlias string
	TakePhoto   bool
}

func (s *Store) MergePlan(intoID, fromID int64) (MergePlan, error) {
	into, from, err := mergePair(s.GetProduct, intoID, fromID)
	if err != nil {
		return MergePlan{}, err
	}
	history, err := s.ListPurchases(from.ID)
	if err != nil {
		return MergePlan{}, err
	}
	aliases, err := s.ListAliasesByProduct(from.ID)
	if err != nil {
		return MergePlan{}, err
	}
	plan := MergePlan{Into: into, From: from, History: len(history), Aliases: len(aliases)}
	fromName := strings.TrimSpace(from.Name)
	if fromName != "" && !strings.EqualFold(fromName, strings.TrimSpace(into.Name)) {
		plan.NameAsAlias = fromName
	}
	plan.TakePhoto = !into.ImagePath.Valid && from.ImagePath.Valid
	return plan, nil
}

func mergePair(get func(int64) (Product, error), intoID, fromID int64) (Product, Product, error) {
	if intoID == fromID {
		return Product{}, Product{}, ErrSameProduct
	}
	into, err := get(intoID)
	if err != nil {
		return Product{}, Product{}, err
	}
	from, err := get(fromID)
	if err != nil {
		return Product{}, Product{}, err
	}
	if into.UnitID != from.UnitID {
		return Product{}, Product{}, ErrUnitMismatch
	}
	return into, from, nil
}

func (s *Store) MergeProducts(intoID, fromID int64) (Product, string, error) {
	if intoID == fromID {
		return Product{}, "", ErrSameProduct
	}
	tx, err := s.db.Begin()
	if err != nil {
		return Product{}, "", err
	}
	defer tx.Rollback()
	keeper, img, err := mergeProductsTx(tx, intoID, fromID)
	if err != nil {
		return Product{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return Product{}, "", err
	}
	return keeper, img, nil
}

func mergeProductsTx(tx *sql.Tx, intoID, fromID int64) (Product, string, error) {
	into, from, err := mergePair(func(id int64) (Product, error) {
		return getProductTx(tx, id)
	}, intoID, fromID)
	if err != nil {
		return Product{}, "", err
	}

	if _, err := tx.Exec(`UPDATE purchases SET product_id = ? WHERE product_id = ?`, into.ID, from.ID); err != nil {
		return Product{}, "", err
	}
	if err := dropConflictingAliases(tx, into, from.ID); err != nil {
		return Product{}, "", err
	}
	if _, err := tx.Exec(`UPDATE product_aliases SET product_id = ? WHERE product_id = ?`, into.ID, from.ID); err != nil {
		return Product{}, "", err
	}

	dropImage, err := handOffImage(tx, into, from)
	if err != nil {
		return Product{}, "", err
	}

	if _, err := tx.Exec(`DELETE FROM products WHERE id = ?`, from.ID); err != nil {
		return Product{}, "", err
	}

	if err := maybeAliasDroppedName(tx, into.ID, into.Name, from.Name); err != nil {
		return Product{}, "", err
	}
	keeper, err := getProductTx(tx, into.ID)
	if err != nil {
		return Product{}, "", err
	}
	return keeper, dropImage, nil
}

func dropConflictingAliases(tx *sql.Tx, into Product, fromID int64) error {
	_, err := tx.Exec(`
DELETE FROM product_aliases
WHERE product_id = ?
  AND (
    alias = ? COLLATE NOCASE
    OR EXISTS (
      SELECT 1 FROM product_aliases AS k
      WHERE k.product_id = ?
        AND k.alias = product_aliases.alias COLLATE NOCASE
        AND (
          (k.company_id IS NULL AND product_aliases.company_id IS NULL)
          OR k.company_id = product_aliases.company_id
        )
    )
  )`, fromID, into.Name, into.ID)
	return err
}

func handOffImage(tx *sql.Tx, into, from Product) (string, error) {
	if into.ImagePath.Valid {
		if from.ImagePath.Valid && from.ImagePath.String != into.ImagePath.String {
			return from.ImagePath.String, nil
		}
		return "", nil
	}
	if !from.ImagePath.Valid {
		return "", nil
	}
	if _, err := tx.Exec(`UPDATE products SET image_path = ? WHERE id = ?`, from.ImagePath.String, into.ID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(`UPDATE products SET image_path = NULL WHERE id = ?`, from.ID); err != nil {
		return "", err
	}
	return "", nil
}

func maybeAliasDroppedName(tx *sql.Tx, intoID int64, intoName, fromName string) error {
	fromName = strings.TrimSpace(fromName)
	if fromName == "" || strings.EqualFold(fromName, strings.TrimSpace(intoName)) {
		return nil
	}
	_, err := createAliasTx(tx, intoID, 0, fromName)
	if err == nil || errors.Is(err, ErrDuplicate) || errors.Is(err, ErrInvalidAlias) {
		return nil
	}
	return err
}
