package main

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Cell-level parsing: share counts, percents, footnote markers, group rows.

// The largest percent of a class a holder can own. Anything above it came from
// the wrong column.
const pctCeiling = 100.0

var (
	// EDGAR renders a superscript footnote mark as "(/2/)" as often as "(2)".
	reFootnote  = regexp.MustCompile(`\(\s*/?\s*([0-9]{1,2}[a-zA-Z]?|[a-zA-Z])\s*/?\s*\)`)
	reSharesNum = regexp.MustCompile(`^-?[0-9][0-9,\. ]*$`)
	rePctNum    = regexp.MustCompile(`((?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))\s*%`)
	rePctBare   = regexp.MustCompile(`^((?:[0-9]{1,3}(?:\.[0-9]+)?|\.[0-9]+))$`)
	reLessThan  = regexp.MustCompile(`(?i)less\s+than\s+(?:one|1)\s*(?:percent|%)|under\s+1\s*%`)
	reStar      = regexp.MustCompile(`^[\*\+#†‡]{1,2}$`)
	reDotPct    = regexp.MustCompile(`^\.[0-9]+\s*%?$`)
	// "As Group (15 persons)" — the article is dropped often enough in ASCII
	// proxies that requiring it loses real group rows.
	reGroupRow   = regexp.MustCompile(`(?i)\bas\s+an?\s+group\b|\bas\s+group\b|\bas\s+a\s+whole\b`)
	reGroupN     = regexp.MustCompile(`(?i)\(\s*([0-9]{1,3})\s+(?:persons?|people|individuals?|directors?|officers?|in\s+number)`)
	reAlphaWords = regexp.MustCompile(`[A-Za-z]{2,}`)
	reShareUnit  = regexp.MustCompile(`(?i)\s*(?:shares?|sh\.?|common\s+shares?|units?)\s*$`)
	reOnlyPunct  = regexp.MustCompile(`^[\s\$\(\)%\*\.\,\-–—:;_]*$`)
	reClassVal   = regexp.MustCompile(`(?i)^(class\s+[a-d]\b.*|common\s+stock.*|common\b.*|series\s+[a-z0-9]+\b.*|preferred\s+stock.*|ordinary\s+shares.*)$`)
)

// StripFootnotes removes trailing footnote references from a holder name and
// returns them. "Robson Walton (1)(2)" -> "Robson Walton", ["1","2"].
func StripFootnotes(s string) (string, []string) {
	s = flat(s)
	var fns []string
	out := reFootnote.ReplaceAllStringFunc(s, func(m string) string {
		g := reFootnote.FindStringSubmatch(m)
		fns = append(fns, g[1])
		return " "
	})
	// Superscript digits used as markers.
	for _, r := range []struct{ sup, d string }{{"¹", "1"}, {"²", "2"}, {"³", "3"},
		{"⁴", "4"}, {"⁵", "5"}, {"⁶", "6"}, {"⁷", "7"}, {"⁸", "8"}, {"⁹", "9"}} {
		if strings.Contains(out, r.sup) {
			fns = append(fns, r.d)
			out = strings.ReplaceAll(out, r.sup, "")
		}
	}
	out = strings.TrimSpace(strings.Trim(norm(out), " .,;:-"))
	sort.Strings(fns)
	return out, uniq(fns)
}

func uniq(xs []string) []string {
	if len(xs) == 0 {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, x := range xs {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}

// ParseShares reads a share count out of a cell, tolerating $ prefixes, footnote
// markers, and the split-cell fragments EDGAR HTML produces.
func ParseShares(s string) (float64, bool) {
	t, _ := StripFootnotes(s)
	// "227,946,104 shares" — the unit word is written into the cell.
	t = reShareUnit.ReplaceAllString(t, "")
	t = strings.NewReplacer("$", "", " ", "", " ", "", ",", "").Replace(t)
	t = strings.TrimSpace(t)
	if t == "" {
		return 0, false
	}
	neg := false
	if strings.HasPrefix(t, "(") && strings.HasSuffix(t, ")") {
		neg, t = true, strings.Trim(t, "()")
	}
	t = strings.TrimSuffix(t, ".")
	if !reSharesNum.MatchString(t) {
		return 0, false
	}
	v, err := strconv.ParseFloat(t, 64)
	if err != nil {
		return 0, false
	}
	if neg {
		v = -v
	}
	return v, true
}

// ParsePercent reads a percent, returning the value, a marker for the
// unparseable-but-meaningful forms, and whether the cell is percent-shaped.
func ParsePercent(s string) (val float64, ok bool, marker string, pctish bool) {
	t, _ := StripFootnotes(s)
	t = norm(strings.ReplaceAll(t, " ", " "))
	if t == "" {
		return 0, false, "", false
	}
	if reStar.MatchString(t) {
		return 0, false, "*", true
	}
	if reLessThan.MatchString(t) {
		return 0, false, "<1%", true
	}
	// ".152%" — a sub-1% holding printed with no leading zero, in a table whose
	// other rows read "22.691%". StripFootnotes trims the leading dot along with
	// the dot leaders, which turns 0.152% into 152%, so it is put back here.
	if reDotPct.MatchString(strings.TrimSpace(s)) && !strings.HasPrefix(t, ".") {
		t = "." + t
	}
	// A percent of a class cannot exceed 100: a value above it is a share
	// count, an age or a dollar figure that landed in the percent column.
	if m := rePctNum.FindStringSubmatch(t); m != nil {
		v, err := strconv.ParseFloat(m[1], 64)
		return v, err == nil && v <= pctCeiling, "", true
	}
	if m := rePctBare.FindStringSubmatch(strings.TrimSuffix(t, "%")); m != nil {
		v, err := strconv.ParseFloat(m[1], 64)
		return v, err == nil && v <= pctCeiling, "", true
	}
	if t == "-" || t == "--" || t == "" {
		return 0, false, "none", true
	}
	return 0, false, "", false
}

// --- collective (D&O aggregate) labels ------------------------------------
//
// Most D&O aggregate rows never say "as a group". The label wraps, so the line
// carrying the numbers holds only a fragment ("All directors", "(24 Persons)",
// "Directors (22 persons,", "those listed above)"), or the proxy simply writes
// "Directors and executive officers". Read as holders these are false 5%
// holders AND the filing then has no group row at all.
//
// The STRONG patterns name a count of persons or a group phrase outright and
// stand on their own. The WEAK patterns are collective nouns, which a real
// holder's name can also carry ("Royce Group", "Trustees of General Electric
// Pension Trust"), so an entity word anywhere in the name vetoes them.
var (
	collNoun = `(?:directors?|director\s+nominees?|nominees?|executive\s+officers?|officers?|persons?|people|individuals?)`

	reGroupCount = regexp.MustCompile(`(?i)\(\s*(?:[0-9]{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|` +
		`eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)[\s,a-z]*\s+` +
		`(?:persons?|people|individuals?|directors?|officers?|in\s+number)`)
	reGroupAbove = regexp.MustCompile(`(?i)those\s+(?:listed|named)\s+above|including\s+those\s+(?:listed|named)`)
	reGroupFrag  = regexp.MustCompile(`(?i)^\(?\s*(?:[0-9]{1,3}\s+)?(?:persons?|people|individuals?)\s*\)`)

	reCollAll  = regexp.MustCompile(`(?i)\ball\s+(?:\w+[\s,]+){0,4}?` + collNoun + `\b`)
	reCollBoth = regexp.MustCompile(`(?i)\b(?:directors|nominees)\b[^,]{0,40}\bofficers\b|` +
		`\bofficers\b[^,]{0,40}\b(?:directors|nominees)\b`)
	reCollLead = regexp.MustCompile(`(?i)^(?:common\s+stock\s+|common\s+)?(?:all\s+|current\s+|the\s+)*` +
		`(?:non-?executive\s+)?(?:` + collNoun + `)\b`)

	// An entity word: this name denotes a firm, a trust or a plan, not a class
	// of natural persons.
	reEntityWord = regexp.MustCompile(`(?i)\b(inc|incorporated|corp|corporation|co|company|companies|llc|` +
		`l\.l\.c|llp|lp|l\.p|ltd|limited|plc|trust|trusts|plan|plans|fund|funds|bank|banks|associates|` +
		`partners|partnership|holdings|capital|management|advisors|advisers|n\.a|savings|pension)\b\.?`)
)

func isGroupRow(name string) (bool, int) {
	strong := reGroupRow.MatchString(name) || reGroupCount.MatchString(name) ||
		reGroupAbove.MatchString(name) || reGroupFrag.MatchString(name)
	grp := strong
	if !grp && !reEntityWord.MatchString(name) {
		grp = reCollAll.MatchString(name) || reCollBoth.MatchString(name) || reCollLead.MatchString(name)
	}
	if !grp {
		return false, 0
	}
	n := 0
	if m := reGroupN.FindStringSubmatch(name); m != nil {
		n, _ = strconv.Atoi(m[1])
	}
	return true, n
}

func hasWords(s string, min int) bool {
	return len(reAlphaWords.FindAllString(s, -1)) >= min
}
