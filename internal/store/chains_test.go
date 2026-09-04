package store

import (
	"errors"
	"testing"
)

func TestRetailChainCRUD(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	chain, err := s.CreateRetailChain("Biedronka", "Jeronimo Martins Polska S.A.", "779-101-13-27")
	if err != nil {
		t.Fatal(err)
	}
	if chain.Name != "Biedronka" || chain.LegalName != "Jeronimo Martins Polska S.A." || chain.TaxID != "7791011327" {
		t.Fatalf("chain: %#v", chain)
	}
	if chain.StoryCount != 0 {
		t.Fatalf("story count: %d", chain.StoryCount)
	}

	got, err := s.GetRetailChain(chain.ID)
	if err != nil || got.ID != chain.ID || got.TaxID != "7791011327" {
		t.Fatalf("get: %v %#v", err, got)
	}

	if err := s.UpdateRetailChain(chain.ID, "Biedra", "Jeronimo Martins Polska S.A.", "7791011327"); err != nil {
		t.Fatal(err)
	}
	got, err = s.GetRetailChain(chain.ID)
	if err != nil || got.Name != "Biedra" {
		t.Fatalf("updated: %v %#v", err, got)
	}

	list, err := s.ListRetailChains()
	if err != nil || len(list) != 1 || list[0].Name != "Biedra" {
		t.Fatalf("list: %v %#v", err, list)
	}

	if err := s.DeleteRetailChain(chain.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetRetailChain(chain.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted: %v", err)
	}
}

func TestRetailChainRequiresFieldsAndUniqueTaxID(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	if _, err := s.CreateRetailChain("", "Legal", "1234567890"); !errors.Is(err, ErrRetailChainName) {
		t.Fatalf("name: %v", err)
	}
	if _, err := s.CreateRetailChain("Biedronka", "", "1234567890"); !errors.Is(err, ErrRetailChainLegalName) {
		t.Fatalf("legal: %v", err)
	}
	if _, err := s.CreateRetailChain("Biedronka", "Legal", "---"); !errors.Is(err, ErrRetailChainTaxID) {
		t.Fatalf("tax: %v", err)
	}

	if _, err := s.CreateRetailChain("Biedronka", "Legal A", "1234567890"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateRetailChain("Lidl", "Legal B", "123-456-78-90"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("dup tax: %v", err)
	}
	if _, err := s.CreateRetailChain("biedronka", "Legal C", "9999999999"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("dup name: %v", err)
	}
}

func TestStoryBelongsToRetailChain(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	chain, err := s.CreateRetailChain("Biedronka", "Jeronimo Martins Polska S.A.", "7791011327")
	if err != nil {
		t.Fatal(err)
	}
	shop, err := s.CreateStory("Biedronka Dworcowa", "Kościuszki", "10", "", "40-001", "Katowice", "", chain.ID)
	if err != nil {
		t.Fatal(err)
	}
	if shop.RetailChainID != chain.ID || shop.RetailChainName != "Biedronka" {
		t.Fatalf("story chain: %#v", shop)
	}

	got, err := s.GetRetailChain(chain.ID)
	if err != nil || got.StoryCount != 1 {
		t.Fatalf("count: %v %#v", err, got)
	}

	if err := s.DeleteRetailChain(chain.ID); !errors.Is(err, ErrRetailChainInUse) {
		t.Fatalf("in use: %v", err)
	}

	if _, err := s.CreateStory("Loose mill", "Kościuszki", "1", "", "40-001", "Katowice", "", chain.ID+99); !errors.Is(err, ErrInvalidRetailChain) {
		t.Fatalf("bad chain: %v", err)
	}

	if err := s.UpdateStory(shop.ID, shop.Name, shop.StreetName, shop.BuildingNumber, shop.ApartmentNumber, shop.PostalCode, shop.City, shop.ExternalID, 0); err != nil {
		t.Fatal(err)
	}
	shop, err = s.GetStory(shop.ID)
	if err != nil || shop.RetailChainID != 0 || shop.RetailChainName != "" {
		t.Fatalf("cleared: %v %#v", err, shop)
	}
	if err := s.DeleteRetailChain(chain.ID); err != nil {
		t.Fatal(err)
	}
}

func TestStoryExternalIDUnique(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	a, err := s.CreateStory("Biedra A", "Kościuszki", "10", "", "40-001", "Katowice", "2615", 0)
	if err != nil {
		t.Fatal(err)
	}
	if a.ExternalID != "2615" {
		t.Fatalf("external id: %#v", a)
	}
	if _, err := s.CreateStory("Biedra B", "Marszałkowska", "2", "", "00-001", "Warszawa", "2615", 0); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("dup code: %v", err)
	}
	b, err := s.CreateStory("Biedra B", "Marszałkowska", "2", "", "00-001", "Warszawa", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateStory(b.ID, b.Name, b.StreetName, b.BuildingNumber, b.ApartmentNumber, b.PostalCode, b.City, "2615", 0); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("dup update: %v", err)
	}
	if err := s.UpdateStory(b.ID, b.Name, b.StreetName, b.BuildingNumber, b.ApartmentNumber, b.PostalCode, b.City, "9001", 0); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetStory(b.ID)
	if err != nil || got.ExternalID != "9001" {
		t.Fatalf("updated: %v %#v", err, got)
	}
}
