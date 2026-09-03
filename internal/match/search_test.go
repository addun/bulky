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

func TestSearchContiguousQueryBeatsTokenHit(t *testing.T) {
	enchanted := Search("hanted Red len", "enchanted Red lentils")
	darkRed := Search("hanted Red len", "Buckwheat DarkRed 84")
	chickpeas := Search("hanted Red len", "Chickpeas IndianRed 25")
	if enchanted <= darkRed || enchanted <= chickpeas {
		t.Fatalf("contiguous %v should outrank token hits %v %v", enchanted, darkRed, chickpeas)
	}
	if enchanted <= containScore {
		t.Fatalf("contiguous should beat flat contain: %v", enchanted)
	}
}
