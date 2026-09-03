package match

import (
	"regexp"
	"strings"
)

const (
	minSearchScore = 0.85
	containScore   = 0.92
)

var (
	numUnit  = regexp.MustCompile(`^\d+([.]\d+)?(kg|g|l|ml|szt|op)$`)
	justNum  = regexp.MustCompile(`^\d+([.]\d+)?$`)
	sizeUnit = map[string]bool{
		"kg": true, "g": true, "l": true, "ml": true, "szt": true, "op": true,
	}
)

func Search(query string, labels ...string) float64 {
	q := stripTrailingSize(fold(query))
	if q == "" {
		return 0
	}
	best := 0.0
	for _, label := range labels {
		if s := searchScore(q, fold(label)); s > best {
			best = s
		}
	}
	return best
}

func searchScore(q, l string) float64 {
	if l == "" {
		return 0
	}
	if q == l {
		return 1
	}
	if strings.Contains(l, q) {
		return substringScore(q, l)
	}
	best := similarity(q, l)
	for _, tok := range strings.Fields(l) {
		if s := similarity(q, tok); s > best {
			best = s
		}
	}
	for _, qt := range strings.Fields(q) {
		if qt == l || strings.Contains(l, qt) {
			if containScore > best {
				best = containScore
			}
			continue
		}
		for _, tok := range strings.Fields(l) {
			if s := similarity(qt, tok); s > best {
				best = s
			}
		}
	}
	if best < minSearchScore {
		return 0
	}
	return best
}

func substringScore(q, l string) float64 {
	nl := runeLen(l)
	if nl == 0 {
		return 0
	}
	cover := float64(runeLen(q)) / float64(nl)
	if cover > 1 {
		cover = 1
	}
	return containScore + (1-containScore)*cover
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
