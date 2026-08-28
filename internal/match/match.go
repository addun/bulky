package match

import (
	"regexp"
	"strings"
	"unicode"
)

const (
	minScore     = 0.85
	ambiguityGap = 0.05
	minLabelLen  = 3
	containScore = 0.92
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

var (
	numUnit  = regexp.MustCompile(`^\d+([.]\d+)?(kg|g|l|ml|szt|op)$`)
	justNum  = regexp.MustCompile(`^\d+([.]\d+)?$`)
	sizeUnit = map[string]bool{
		"kg": true, "g": true, "l": true, "ml": true, "szt": true, "op": true,
	}
	foldPolish = map[rune]rune{
		'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
		'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
	}
)

func Product(query string, shop, global, names []Label) (int64, bool) {
	if strings.TrimSpace(query) == "" {
		return 0, false
	}
	for _, pool := range [][]Label{shop, global, names} {
		id, res := matchPool(query, pool)
		switch res {
		case hit:
			return id, true
		case ambiguous:
			return 0, false
		}
	}
	return 0, false
}

func matchPool(query string, labels []Label) (int64, result) {
	bestByProduct := map[int64]float64{}
	for _, lab := range labels {
		s := Score(query, lab.Text)
		if s <= 0 {
			continue
		}
		if s > bestByProduct[lab.ProductID] {
			bestByProduct[lab.ProductID] = s
		}
	}
	var bestID int64
	var best, second float64
	for id, s := range bestByProduct {
		if s > best {
			second = best
			best = s
			bestID = id
		} else if s > second {
			second = s
		}
	}
	if best < minScore {
		return 0, none
	}
	if second >= minScore && best-second < ambiguityGap {
		return 0, ambiguous
	}
	return bestID, hit
}

func Score(query, label string) float64 {
	q := Normalize(query)
	l := Normalize(label)
	if q == "" || l == "" {
		return 0
	}
	if q == l {
		if runeLen(l) < minLabelLen {
			return 0
		}
		return 1
	}
	if runeLen(l) < minLabelLen {
		return 0
	}
	if containsTokens(q, l) {
		return containScore
	}
	return similarity(q, l)
}

func Normalize(s string) string {
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
	return stripTrailingSize(strings.TrimSpace(b.String()))
}

func stripTrailingSize(s string) string {
	toks := strings.Fields(s)
	if len(toks) == 0 {
		return s
	}
	last := toks[len(toks)-1]
	if numUnit.MatchString(last) {
		toks = toks[:len(toks)-1]
	} else if sizeUnit[last] && len(toks) >= 2 && justNum.MatchString(toks[len(toks)-2]) {
		toks = toks[:len(toks)-2]
	}
	return strings.Join(toks, " ")
}

func containsTokens(a, b string) bool {
	at, bt := strings.Fields(a), strings.Fields(b)
	short, long := at, bt
	shortStr := a
	if len(at) > len(bt) {
		short, long = bt, at
		shortStr = b
	}
	if len(short) == 0 || runeLen(shortStr) < minLabelLen {
		return false
	}
	for i := 0; i+len(short) <= len(long); i++ {
		ok := true
		for j := range short {
			if short[j] != long[i+j] {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

func similarity(a, b string) float64 {
	d := levenshtein(a, b)
	n := runeLen(a)
	if m := runeLen(b); m > n {
		n = m
	}
	if n == 0 {
		return 1
	}
	return 1 - float64(d)/float64(n)
}

func levenshtein(a, b string) int {
	ar, br := []rune(a), []rune(b)
	if len(ar) == 0 {
		return len(br)
	}
	if len(br) == 0 {
		return len(ar)
	}
	prev := make([]int, len(br)+1)
	cur := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	for i, ra := range ar {
		cur[0] = i + 1
		for j, rb := range br {
			cost := 1
			if ra == rb {
				cost = 0
			}
			del := prev[j+1] + 1
			ins := cur[j] + 1
			sub := prev[j] + cost
			if ins < del {
				del = ins
			}
			if sub < del {
				del = sub
			}
			cur[j+1] = del
		}
		prev, cur = cur, prev
	}
	return prev[len(br)]
}

func runeLen(s string) int {
	n := 0
	for range s {
		n++
	}
	return n
}
