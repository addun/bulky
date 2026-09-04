package store

import (
	"errors"
	"testing"

	"github.com/shopspring/decimal"
)

func TestMergePlanCountsHistoryAndAliases(t *testing.T) {
	s, _, flour, rice, lidl, biedronka := aliasFixture(t)
	if _, err := s.CreatePurchase(rice.ID, lidl.ID, "2026-08-20", mustDec(t, "2"), mustDec(t, "9.90"), KindPurchase, decimal.Zero, decimal.Zero); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAlias(rice.ID, biedronka.ID, 0, "Ryż biały"); err != nil {
		t.Fatal(err)
	}
	plan, err := s.MergePlan(flour.ID, rice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if plan.From.ID != rice.ID || plan.Into.ID != flour.ID {
		t.Fatalf("pair: %#v", plan)
	}
	if plan.History != 1 || plan.Aliases != 1 || plan.NameAsAlias != "Rice" {
		t.Fatalf("counts: %#v", plan)
	}
	if plan.TakePhoto {
		t.Fatal("neither product has a photo")
	}
	if _, err := s.MergePlan(flour.ID, flour.ID); !errors.Is(err, ErrSameProduct) {
		t.Fatalf("self: %v", err)
	}
}

func TestMergeProductsMovesPurchasesAndAliases(t *testing.T) {
	s, _, flour, rice, lidl, biedronka := aliasFixture(t)
	buy, err := s.CreatePurchase(rice.ID, lidl.ID, "2026-08-20", mustDec(t, "2"), mustDec(t, "9.90"), KindPurchase, decimal.Zero, decimal.Zero)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAlias(rice.ID, biedronka.ID, 0, "Ryż biały"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAlias(flour.ID, 0, 0, "Tortowa"); err != nil {
		t.Fatal(err)
	}

	keeper, img, err := s.MergeProducts(flour.ID, rice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if keeper.ID != flour.ID || keeper.Name != "Cake flour" {
		t.Fatalf("keeper: %#v", keeper)
	}
	if img != "" {
		t.Fatalf("unexpected image %q", img)
	}
	if _, err := s.GetProduct(rice.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("rice should be gone: %v", err)
	}

	purchases, err := s.ListPurchases(flour.ID)
	if err != nil || len(purchases) != 1 {
		t.Fatalf("purchases: %v %#v", err, purchases)
	}
	if purchases[0].ID != buy.ID || purchases[0].ProductID != flour.ID || purchases[0].StoryID != lidl.ID {
		t.Fatalf("moved purchase: %#v", purchases[0])
	}

	aliases, err := s.ListAliasesByProduct(flour.ID)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]int64{}
	for _, a := range aliases {
		got[a.Alias] = a.StoryID
	}
	if got["Tortowa"] != 0 || got["Ryż biały"] != biedronka.ID || got["Rice"] != 0 {
		t.Fatalf("aliases: %#v", aliases)
	}

	hit, err := s.FindProductByName("Rice", 0)
	if err != nil || hit.ID != flour.ID {
		t.Fatalf("dropped name should match: %v %#v", err, hit)
	}
	hit, err = s.FindProductByName("Ryż biały", biedronka.ID)
	if err != nil || hit.ID != flour.ID {
		t.Fatalf("moved shop alias: %v %#v", err, hit)
	}
}

func TestMergeProductsSkipsDroppedNameWhenNamesMatch(t *testing.T) {
	s, kg, flour, _, _, _ := aliasFixture(t)
	dup, err := s.CreateProduct("cake flour", kg.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.MergeProducts(flour.ID, dup.ID); err != nil {
		t.Fatal(err)
	}
	aliases, err := s.ListAliasesByProduct(flour.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range aliases {
		if a.Alias == "cake flour" || a.Alias == "Cake flour" {
			t.Fatalf("should not alias the catalog name: %#v", aliases)
		}
	}
}

func TestMergeProductsRejectsUnitMismatchAndSelf(t *testing.T) {
	s, _, flour, rice, _, _ := aliasFixture(t)
	kg, err := s.FindUnitByName("kg")
	if err != nil {
		t.Fatal(err)
	}
	sugar, err := s.CreateProduct("Sugar", kg.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.MergeProducts(flour.ID, sugar.ID); !errors.Is(err, ErrUnitMismatch) {
		t.Fatalf("units: %v", err)
	}
	if _, err := s.GetProduct(sugar.ID); err != nil {
		t.Fatalf("sugar should remain: %v", err)
	}
	if _, _, err := s.MergeProducts(flour.ID, flour.ID); !errors.Is(err, ErrSameProduct) {
		t.Fatalf("self: %v", err)
	}
	if _, _, err := s.MergeProducts(flour.ID, 999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing from: %v", err)
	}
	if _, _, err := s.MergeProducts(999, rice.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing into: %v", err)
	}
}

func TestMergeProductsHandsOffImage(t *testing.T) {
	s, kg, flour, _, _, _ := aliasFixture(t)
	path := "from.jpg"
	dup, err := s.CreateProduct("Pastry flour", kg.ID, &path)
	if err != nil {
		t.Fatal(err)
	}
	keeper, img, err := s.MergeProducts(flour.ID, dup.ID)
	if err != nil {
		t.Fatal(err)
	}
	if img != "" {
		t.Fatalf("keeper had no photo, should keep the file: %q", img)
	}
	if !keeper.ImagePath.Valid || keeper.ImagePath.String != "from.jpg" {
		t.Fatalf("image: %#v", keeper.ImagePath)
	}
}

func TestMergeProductsDeletesAbsorbedImage(t *testing.T) {
	s, kg, _, _, _, _ := aliasFixture(t)
	keepPath := "keep.jpg"
	dropPath := "drop.jpg"
	into, err := s.CreateProduct("Oats", kg.ID, &keepPath)
	if err != nil {
		t.Fatal(err)
	}
	from, err := s.CreateProduct("Rolled oats", kg.ID, &dropPath)
	if err != nil {
		t.Fatal(err)
	}
	keeper, img, err := s.MergeProducts(into.ID, from.ID)
	if err != nil {
		t.Fatal(err)
	}
	if img != "drop.jpg" {
		t.Fatalf("should delete absorbed photo: %q", img)
	}
	if !keeper.ImagePath.Valid || keeper.ImagePath.String != "keep.jpg" {
		t.Fatalf("keeper photo: %#v", keeper.ImagePath)
	}
}
