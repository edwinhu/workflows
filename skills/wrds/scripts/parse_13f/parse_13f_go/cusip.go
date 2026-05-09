package main

import (
	"regexp"
	"strings"
)

var (
	reCUSIP9 = regexp.MustCompile(`^[0-9A-Z]{8}[0-9]$`)
	reCUSIP8 = regexp.MustCompile(`^[0-9A-Z]{8}$`)
)

// normalizeCUSIP uppercases, strips whitespace, and validates a CUSIP string.
// Returns the 9-, 8-, and 6-char forms plus a validity flag.
//
// Valid CUSIP-9: 8 alphanumeric chars + 1 check digit (digit only).
// 8-char input: treated as CUSIP-8 — cusip9 gets a "0" placeholder suffix,
// cusip_valid is false, but cusip8/cusip6 are still derived.
func normalizeCUSIP(raw string) (cusip9, cusip8, cusip6 string, valid bool) {
	s := strings.ToUpper(strings.TrimSpace(raw))

	switch {
	case len(s) == 9 && reCUSIP9.MatchString(s):
		return s, s[:8], s[:6], true
	case len(s) == 8 && reCUSIP8.MatchString(s):
		return s + "0", s, s[:6], false
	default:
		return s, "", "", false
	}
}
