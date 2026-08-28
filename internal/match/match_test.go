package match

import "testing"

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"MĄKA TORTOWA 1KG":   "maka tortowa",
		"Mąka tortowa 1 kg":  "maka tortowa",
		"  Maka,  tortowa. ": "maka tortowa",
		"RYZ 10KG":           "ryz",
		"Flour 500 g":        "flour",
		"Oil 2l":             "oil",
	}
	for in, want := range cases {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q)=%q want %q", in, got, want)
		}
	}
}

func TestScoreExactAndDiacritics(t *testing.T) {
	if s := Score("MĄKA", "Mąka"); s != 1 {
		t.Fatalf("diacritics: %v", s)
	}
	if s := Score("Tortowa", "Tortowa"); s != 1 {
		t.Fatalf("exact: %v", s)
	}
}

func TestScoreTypo(t *testing.T) {
	s := Score("Tortova", "Tortowa")
	if s < minScore {
		t.Fatalf("typo score %v", s)
	}
}

func TestScoreTokenContainment(t *testing.T) {
	s := Score("MAKA TORTOWA 1KG", "Mąka")
	if s != containScore {
		t.Fatalf("containment: %v", s)
	}
	if Score("ab", "ab") != 0 {
		t.Fatal("short labels should be ignored")
	}
	if Score("xy", "xyz") >= minScore {
		t.Fatal("short query must not be a confident match")
	}
}

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

	id, ok = Product("MAKA TORTOWA 1KG", nil, []Label{{ProductID: 4, Text: "Mąka tortowa"}}, names)
	if !ok || id != 4 {
		t.Fatalf("fuzzy till line: id=%d ok=%v", id, ok)
	}
}

func TestProductAmbiguous(t *testing.T) {
	global := []Label{
		{ProductID: 4, Text: "Mąka pszenna"},
		{ProductID: 6, Text: "Mąka żytnia"},
	}
	if _, ok := Product("Mąka", nil, global, nil); ok {
		t.Fatal("two close alias hits should stay unmatched")
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
