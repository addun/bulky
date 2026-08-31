package match

import (
	"strings"
	"unicode"
)

type Label struct {
	ProductID int64
	Text      string
}

type result int

const (
	none result = iota
	hit
	ambiguous
)

var foldPolish = map[rune]rune{
	'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
	'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
}

func Product(query string, shop, global, names []Label) (int64, bool) {
	if strings.TrimSpace(query) == "" {
		return 0, false
	}
	for _, pool := range [][]Label{shop, global, names} {
		id, res := exactPool(query, pool)
		switch res {
		case hit:
			return id, true
		case ambiguous:
			return 0, false
		}
	}
	return 0, false
}

func exactPool(query string, labels []Label) (int64, result) {
	q := fold(query)
	if q == "" {
		return 0, none
	}
	matched := map[int64]struct{}{}
	for _, lab := range labels {
		if fold(lab.Text) != q {
			continue
		}
		matched[lab.ProductID] = struct{}{}
	}
	switch len(matched) {
	case 0:
		return 0, none
	case 1:
		for id := range matched {
			return id, hit
		}
	}
	return 0, ambiguous
}

func fold(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := true
	for _, r := range s {
		r = unicode.ToLower(r)
		if mapped, ok := foldPolish[r]; ok {
			r = mapped
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			prevSpace = false
			continue
		}
		if !prevSpace {
			b.WriteByte(' ')
			prevSpace = true
		}
	}
	return strings.TrimSpace(b.String())
}
