package store

import (
	"fmt"
	"strings"
	"time"
)

const (
	boughtOnDate  = "2006-01-02"
	boughtOnClock = "15:04"
)

// JoinBoughtOn combines a calendar day and clock into the bought_on form
// stored on purchases: "2006-01-02" or "2006-01-02 15:04".
func JoinBoughtOn(date, clock string) string {
	date, existing := SplitBoughtOn(date)
	clock = strings.TrimSpace(clock)
	if clock == "" {
		clock = existing
	} else if t := clockPart(clock); t != "" {
		clock = t
	}
	if date == "" {
		return ""
	}
	if clock == "" {
		return date
	}
	return date + " " + clock
}

func SplitBoughtOn(s string) (date, clock string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", ""
	}
	s = strings.ReplaceAll(s, "T", " ")
	s = strings.ReplaceAll(s, "\u00a0", " ")
	parts := strings.Fields(s)
	date = parts[0]
	if len(parts) >= 2 {
		clock = clockPart(parts[1])
	}
	return date, clock
}

func NormalizeBoughtOn(s string) (string, error) {
	date, clock := SplitBoughtOn(s)
	if date == "" {
		return "", fmt.Errorf("required")
	}
	if _, err := time.Parse(boughtOnDate, date); err != nil {
		return "", err
	}
	if clock == "" {
		return date, nil
	}
	if _, err := time.Parse(boughtOnClock, clock); err != nil {
		return "", err
	}
	return date + " " + clock, nil
}

func BoughtOnDate(s string) string {
	date, _ := SplitBoughtOn(s)
	return date
}

func BoughtOnTime(s string) string {
	_, clock := SplitBoughtOn(s)
	return clock
}

func FormatBoughtOn(s string) string {
	date, clock := SplitBoughtOn(s)
	if date == "" {
		return strings.TrimSpace(s)
	}
	if clock == "" {
		return date
	}
	return date + " " + clock
}

func clockPart(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, ".", ":")
	if i := strings.IndexByte(s, 'Z'); i >= 0 {
		s = s[:i]
	}
	if len(s) >= 8 {
		if _, err := time.Parse("15:04:05", s[:8]); err == nil {
			return s[:5]
		}
	}
	if len(s) >= 5 {
		if _, err := time.Parse(boughtOnClock, s[:5]); err == nil {
			return s[:5]
		}
	}
	return ""
}
