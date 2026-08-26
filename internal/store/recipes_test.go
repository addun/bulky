package store

import (
	"encoding/json"
	"testing"
)

func TestRecipeAIThenMigrate(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	units, err := s.ListUnits()
	if err != nil || len(units) == 0 {
		t.Fatalf("units: %v %#v", err, units)
	}
	co, err := s.CreateCompany("Local Mill", "Kościuszki", "10", "", "40-001", "Katowice")
	if err != nil {
		t.Fatal(err)
	}

	r, err := s.CreateRecipe("aabbccddeeff00112233445566778899")
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != RecipePending || r.RawResponse != "" {
		t.Fatalf("create: %#v", r)
	}

	raw, _ := json.Marshal(map[string]any{
		"bought_on": "2026-08-20",
		"lines": []map[string]any{
			{"product_name": "Rice", "quantity": "10", "amount": "40.00", "unit_id": units[0].ID},
		},
	})
	if err := s.SaveAIResponse(r.ID, string(raw)); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetRecipe(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != RecipeReady || got.RawResponse != string(raw) {
		t.Fatalf("ready: %#v", got)
	}

	res, err := s.MigrateRecipe(r.ID, BillImport{
		CompanyID: co.ID,
		BoughtOn:  "2026-08-20",
		Lines: []BillLineInput{
			{ProductName: "Rice", UnitID: units[0].ID, Quantity: mustDec(t, "10"), Amount: mustDec(t, "40.00")},
		},
	}, `{"bought_on":"2026-08-20"}`)
	if err != nil {
		t.Fatal(err)
	}
	if res.Purchases != 1 {
		t.Fatalf("purchases: %d", res.Purchases)
	}
	got, err = s.GetRecipe(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != RecipeMigrated {
		t.Fatalf("status %q", got.Status)
	}

	if _, err := s.MigrateRecipe(r.ID, BillImport{
		BoughtOn: "2026-08-20",
		Lines: []BillLineInput{
			{ProductName: "Rice", UnitID: units[0].ID, Quantity: mustDec(t, "1"), Amount: mustDec(t, "1")},
		},
	}, "{}"); err != ErrRecipeMigrated {
		t.Fatalf("second migrate: %v", err)
	}

	rice, err := s.FindProductByName("Rice")
	if err != nil {
		t.Fatal(err)
	}
	buys, err := s.ListPurchases(rice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(buys) != 1 {
		t.Fatalf("rice purchases: %d", len(buys))
	}
	if buys[0].RecipeID != r.ID {
		t.Fatalf("recipe_id: got %d want %d", buys[0].RecipeID, r.ID)
	}
	if buys[0].Kind != KindPurchase {
		t.Fatalf("kind: got %q want %q", buys[0].Kind, KindPurchase)
	}
	if buys[0].CompanyID != co.ID {
		t.Fatalf("company_id: got %d want %d", buys[0].CompanyID, co.ID)
	}
}

func TestFailRecipe(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r, err := s.CreateRecipe("photo")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.FailRecipe(r.ID); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetRecipe(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != RecipeFailed {
		t.Fatalf("status %q", got.Status)
	}
	if _, err := s.MigrateRecipe(r.ID, BillImport{
		BoughtOn: "2026-08-20",
		Lines:    []BillLineInput{{ProductName: "X", UnitID: 1, Quantity: mustDec(t, "1"), Amount: mustDec(t, "1")}},
	}, "{}"); err != ErrRecipeNotReady {
		t.Fatalf("migrate failed recipe: %v", err)
	}
}
