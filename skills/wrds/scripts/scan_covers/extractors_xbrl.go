package main

import (
	"regexp"
	"strconv"
	"strings"
)

// extractors_xbrl — fallback extractors for SCHEDULE 13D/G filings delivered
// as XBRL primary_doc.xml (SEC rule effective late 2024). The WRDS-clean
// pipeline strips the XML tags, leaving the cover-page values as bare
// whitespace-separated tokens — one line per field — with no "PERCENT OF
// CLASS" / "TYPE OF REPORTING PERSON" anchor phrases for the legacy
// pattern-based extractors to match.
//
// Structural anchor: each reporting person's cover page ends with the
// sequence
//
//     <row11 aggregate (numeric) or row12 checkbox (Y/N)>
//     <row13 percent of class (0-100)>
//     <row14 type of reporting person (2-letter code from item12 set)>
//
// We find every such triple by scanning consecutive non-blank lines. Across
// one filing we emit the pipe-joined item12 union and the max percent —
// matching Volkova's multi-filer aggregation semantics.

var (
	// Item-12 code set in uppercase (XBRL casing is consistent). Matches
	// parser.py _CODE_LIST with the same 14 codes.
	xbrlItem12Codes = map[string]bool{
		"BD": true, "BK": true, "IC": true, "IV": true, "IA": true,
		"EP": true, "HC": true, "SA": true, "CP": true, "CO": true,
		"PN": true, "IN": true, "FI": true, "OO": true,
	}
	reXbrlPercent = regexp.MustCompile(`^\d{1,3}(?:\.\d+)?$`)
	reXbrlNumber  = regexp.MustCompile(`^-?\d+(?:\.\d+)?$`)
)

type xbrlPair struct {
	prc  float64
	code string
}

func xbrlPairs(body string) []xbrlPair {
	raw := strings.Split(body, "\n")
	lines := make([]string, 0, len(raw))
	for _, ln := range raw {
		t := strings.TrimSpace(ln)
		if t != "" {
			lines = append(lines, t)
		}
	}
	var out []xbrlPair
	for i := 1; i < len(lines)-1; i++ {
		mid := lines[i]
		if !reXbrlPercent.MatchString(mid) {
			continue
		}
		v, err := strconv.ParseFloat(mid, 64)
		if err != nil || v < 0 || v > 100 {
			continue
		}
		prev := lines[i-1]
		if prev != "Y" && prev != "N" && !reXbrlNumber.MatchString(prev) {
			continue
		}
		next := lines[i+1]
		if !xbrlItem12Codes[next] {
			continue
		}
		out = append(out, xbrlPair{prc: v, code: strings.ToLower(next)})
	}
	return out
}

// extractMaxPrcXbrl returns the max percent-of-class from the XBRL cover-page
// triples, or "" if no triple is found.
func extractMaxPrcXbrl(buf []byte) string {
	pairs := xbrlPairs(string(buf))
	if len(pairs) == 0 {
		return ""
	}
	best := pairs[0].prc
	for _, p := range pairs[1:] {
		if p.prc > best {
			best = p.prc
		}
	}
	return strconv.FormatFloat(best, 'f', -1, 64)
}

// extractItem12Xbrl returns the pipe-joined union (dedup, priority-ordered)
// of item12 codes from the XBRL cover-page triples, or "" if none.
func extractItem12Xbrl(buf []byte) string {
	pairs := xbrlPairs(string(buf))
	if len(pairs) == 0 {
		return ""
	}
	seen := map[string]bool{}
	for _, p := range pairs {
		seen[p.code] = true
	}
	var ordered []string
	for _, code := range item12CodeList {
		if seen[code] {
			ordered = append(ordered, code)
		}
	}
	return strings.Join(ordered, "|")
}
