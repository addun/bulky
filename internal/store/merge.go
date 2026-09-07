package store

import (
	"errors"
	"strings"

	"github.com/adrian/bulkly/internal/store/sqlc"
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
	if err := conversionMergeConflict(into.Conversions, from.Conversions); err != nil {
		return MergePlan{}, err
	}
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
	var keeper Product
	var img string
	err := s.withTx(func(q *sqlc.Queries) error {
		var err error
		keeper, img, err = mergeProducts(q, intoID, fromID)
		return err
	})
	return keeper, img, err
}

func mergeProducts(q *sqlc.Queries, intoID, fromID int64) (Product, string, error) {
	into, from, err := mergePair(func(id int64) (Product, error) {
		return getProduct(q, id)
	}, intoID, fromID)
	if err != nil {
		return Product{}, "", err
	}

	if err := mergeConversions(q, into.ID, from.ID); err != nil {
		return Product{}, "", err
	}

	if err := q.ReassignPurchases(ctx(), sqlc.ReassignPurchasesParams{IntoID: into.ID, FromID: from.ID}); err != nil {
		return Product{}, "", err
	}
	if err := q.DropConflictingAliases(ctx(), sqlc.DropConflictingAliasesParams{
		FromID:   from.ID,
		IntoName: into.Name,
		IntoID:   into.ID,
	}); err != nil {
		return Product{}, "", err
	}
	if err := q.ReassignAliases(ctx(), sqlc.ReassignAliasesParams{IntoID: into.ID, FromID: from.ID}); err != nil {
		return Product{}, "", err
	}

	dropImage, err := handOffImage(q, into, from)
	if err != nil {
		return Product{}, "", err
	}

	if err := q.DeleteProduct(ctx(), from.ID); err != nil {
		return Product{}, "", err
	}

	if err := maybeAliasDroppedName(q, into.ID, into.Name, from.Name); err != nil {
		return Product{}, "", err
	}
	keeper, err := getProduct(q, into.ID)
	if err != nil {
		return Product{}, "", err
	}
	return keeper, dropImage, nil
}

func handOffImage(q *sqlc.Queries, into, from Product) (string, error) {
	if into.ImagePath.Valid {
		if from.ImagePath.Valid && from.ImagePath.String != into.ImagePath.String {
			return from.ImagePath.String, nil
		}
		return "", nil
	}
	if !from.ImagePath.Valid {
		return "", nil
	}
	if err := q.UpdateProductImage(ctx(), sqlc.UpdateProductImageParams{
		ImagePath: from.ImagePath,
		ID:        into.ID,
	}); err != nil {
		return "", err
	}
	if err := q.UpdateProductImage(ctx(), sqlc.UpdateProductImageParams{
		ImagePath: nullStringPtr(nil),
		ID:        from.ID,
	}); err != nil {
		return "", err
	}
	return "", nil
}

func maybeAliasDroppedName(q *sqlc.Queries, intoID int64, intoName, fromName string) error {
	fromName = strings.TrimSpace(fromName)
	if fromName == "" || strings.EqualFold(fromName, strings.TrimSpace(intoName)) {
		return nil
	}
	_, err := createAlias(q, intoID, 0, 0, fromName)
	if err == nil || errors.Is(err, ErrDuplicate) || errors.Is(err, ErrInvalidAlias) {
		return nil
	}
	return err
}
