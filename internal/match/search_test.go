package match

import "testing"

func TestSearchNameAndAlias(t *testing.T) {
	if s := Search("Cake flour", "Cake flour"); s != 1 {
		t.Fatalf("exact: %v", s)
	}
	if s := Search("maka", "Mąka tortowa", "Cake flour"); s < containScore {
		t.Fatalf("diacritics/substring: %v", s)
	}
	if s := Search("tortova", "Mąka tortowa 1kg"); s < minSearchScore {
		t.Fatalf("typo: %v", s)
	}
	if s := Search("maka 1kg", "Mąka tortowa"); s < containScore {
		t.Fatalf("trailing size on query: %v", s)
	}
	if s := Search("flour", "Cake flour"); s < containScore {
		t.Fatalf("token: %v", s)
	}
	if Search("Ghost", "Rice", "Cake flour") != 0 {
		t.Fatal("miss")
	}
	if Search("", "Rice") != 0 {
		t.Fatal("empty")
	}
}
