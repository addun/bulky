package match

import "testing"

func TestProductMatchPriority(t *testing.T) {
	shop := []Label{{ProductID: 5, Text: "Mąka"}}
	global := []Label{{ProductID: 4, Text: "Mąka"}, {ProductID: 4, Text: "Tortowa"}}
	names := []Label{{ProductID: 4, Text: "Cake flour"}, {ProductID: 5, Text: "Rice"}}

	id, ok := Product("MĄKA", shop, global, names)
	if !ok || id != 5 {
		t.Fatalf("shop should win: id=%d ok=%v", id, ok)
	}

	id, ok = Product("Tortowa", nil, global, names)
	if !ok || id != 4 {
		t.Fatalf("global: id=%d ok=%v", id, ok)
	}

	id, ok = Product("Cake flour", nil, nil, names)
	if !ok || id != 4 {
		t.Fatalf("name: id=%d ok=%v", id, ok)
	}

	id, ok = Product("  Cake,  flour ", nil, nil, names)
	if !ok || id != 4 {
		t.Fatalf("spaces and punctuation: id=%d ok=%v", id, ok)
	}

	id, ok = Product("MAKA TORTOWA 1KG", nil, []Label{{ProductID: 4, Text: "Mąka tortowa 1kg"}}, names)
	if !ok || id != 4 {
		t.Fatalf("exact alias: id=%d ok=%v", id, ok)
	}
}

func TestProductRejectsFuzzy(t *testing.T) {
	names := []Label{{ProductID: 4, Text: "Cake flour"}, {ProductID: 5, Text: "Rice"}}

	if _, ok := Product("Tortova", nil, []Label{{ProductID: 4, Text: "Tortowa"}}, nil); ok {
		t.Fatal("alias typo should not match")
	}
	if _, ok := Product("Cak flour", nil, nil, names); ok {
		t.Fatal("catalog typo should not match")
	}
	if _, ok := Product("MAKA TORTOWA 1KG", nil, []Label{{ProductID: 4, Text: "Mąka tortowa"}}, names); ok {
		t.Fatal("shorter alias should not match")
	}
	if _, ok := Product("Rice 1kg", nil, nil, names); ok {
		t.Fatal("trailing size should not match a catalog name")
	}
	if _, ok := Product("MAKA TORTOWA 1KG", nil, nil, []Label{{ProductID: 4, Text: "Mąka"}}); ok {
		t.Fatal("catalog name must not match by token containment")
	}
}

func TestProductAmbiguous(t *testing.T) {
	global := []Label{
		{ProductID: 4, Text: "Mąka"},
		{ProductID: 6, Text: "Mąka"},
	}
	if _, ok := Product("Mąka", nil, global, nil); ok {
		t.Fatal("two exact alias hits should stay unmatched")
	}

	names := []Label{
		{ProductID: 4, Text: "Rice"},
		{ProductID: 6, Text: "Rice"},
	}
	if _, ok := Product("Rice", nil, nil, names); ok {
		t.Fatal("two exact catalog hits should stay unmatched")
	}
}

func TestProductEmptyAndMiss(t *testing.T) {
	if _, ok := Product("", nil, []Label{{ProductID: 1, Text: "Rice"}}, nil); ok {
		t.Fatal("empty query")
	}
	if _, ok := Product("Ghost", nil, nil, []Label{{ProductID: 1, Text: "Rice"}}); ok {
		t.Fatal("miss")
	}
}
