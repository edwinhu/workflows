package main

import (
	"math"
	"regexp"
	"sort"
	"strings"
)

// The screen runs once over a filing's extracted rows, after both parsers, and
// removes rows whose LAYOUT says the cells were read from the wrong columns or
// that the "holder" is not a holder at all. It is deliberately a separate pass:
// several of the rules need the whole table (its median implied total, whether a
// percent repeats down the column), which no per-row extractor can see.
//
// A group row is never dropped. group_row_detection_rate is a gated metric and a
// collective label is exactly the text several of these patterns would match.

var (
	// A market index or peer-group label down the stub of a stock-performance
	// graph. The graph's indexed values start at 100 and read as percents.
	reScreenIndex = regexp.MustCompile(`(?i)(?:^|\b)(?:s\s*&\s*p|standard\s*&\s*poor|russell\s*\d|dow\s+jones|dj\s+[a-z]|nasdaq|nyse\s+(?:index|market|composite)|amex\s+index|wilshire|value\s+line|peer\s+group|peer\s+index)\b|\b(?:index|indices)$`)
	// A bare period label: the same graph's month, quarter or year stub.
	reScreenDate = regexp.MustCompile(`(?i)^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s\-/,]*(?:\d{1,4})?$|^(?:19|20)\d\d$|^(?:1[0-2]|[1-9])/(?:19|20)?\d\d$|^fy\s*\d+$|^(?:q[1-4]|[1-4]q)[\s\-/]*\d{2,4}$`)
	// Prose or a column header that reached the name column: a lead-in
	// sentence's tail, or the "Sole Voting Power" style sub-heading.
	reScreenProse = regexp.MustCompile(`(?i)\b(?:known\s+to\s+the\s+(?:company|registrant)|beneficial\s+owner(?:s)?\s+of\s+more\s+than|as\s+(?:investment\s+)?advis[eo]r|sole\s+(?:voting|dispositive)|shared\s+(?:voting|dispositive)|dispositive\s+power|voting\s+power)\b`)
	// A foreign address line: a Canadian/UK postal code, or a country tail.
	reScreenForeign = regexp.MustCompile(`(?i)\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b|\b(?:canada|england|scotland|united\s+kingdom|switzerland|netherlands|germany|japan|france|australia|bermuda|cayman\s+islands)\s*$`)
	// A share class that is not the common stock blockw records. "Class A" is
	// left out on purpose: it is routinely the only common class there is.
	reScreenNonCommon = regexp.MustCompile(`(?i)\bpreferred\b|\bseries\s+[a-z0-9]+\b|\bclass\s+[b-z]\b|\besop\b|\bjunior\b|\bconvertible\b|\bdepositary\b|\bdebenture|\bwarrant|\boption\b`)
)

// screenTable is the per-table context the row rules need.
type screenTable struct {
	isGraph     bool            // a stock-performance graph, not an ownership table
	medianTotal float64         // median shares/(pct/100) over the table's own rows
	haveMedian  bool            //
	pctRepeats  map[float64]int // how many distinct non-group rows carry each percent
}

// ScreenRows returns the rows of one filing that survive the layout screen, in
// their original order. The input slice is not modified.
func ScreenRows(rows []Row) []Row {
	tabs := screenTables(rows)
	out := make([]Row, 0, len(rows))
	for _, r := range rows {
		if !screenDrop(r, tabs[r.TableIndex]) {
			out = append(out, r)
		}
	}
	return out
}

func screenTables(rows []Row) map[int]*screenTable {
	tabs := map[int]*screenTable{}
	implied := map[int][]float64{}
	dateRows := map[int]int{}
	for _, r := range rows {
		t := tabs[r.TableIndex]
		if t == nil {
			t = &screenTable{pctRepeats: map[float64]int{}}
			tabs[r.TableIndex] = t
		}
		name := strings.TrimSpace(r.HolderName)
		if !r.IsGroupRow {
			if reScreenIndex.MatchString(name) {
				t.isGraph = true
			}
			if reScreenDate.MatchString(name) {
				dateRows[r.TableIndex]++
			}
			if r.Percent != nil && *r.Percent >= 5.0 {
				t.pctRepeats[*r.Percent]++
			}
		}
		if r.Shares != nil && *r.Shares > 0 && r.Percent != nil && *r.Percent >= 0.5 {
			implied[r.TableIndex] = append(implied[r.TableIndex], *r.Shares/(*r.Percent/100.0))
		}
	}
	// Three period labels in one table is a graph stub, not a coincidence.
	for ti, n := range dateRows {
		if n >= 3 {
			tabs[ti].isGraph = true
		}
	}
	for ti, v := range implied {
		if len(v) < 3 {
			continue
		}
		s := make([]float64, len(v))
		copy(s, v)
		sort.Float64s(s)
		tabs[ti].medianTotal, tabs[ti].haveMedian = s[len(s)/2], true
	}
	return tabs
}

func screenDrop(r Row, t *screenTable) bool {
	if r.IsGroupRow {
		return false
	}
	if t != nil && t.isGraph {
		return true
	}
	name := strings.TrimSpace(r.HolderName)
	switch {
	case reScreenIndex.MatchString(name), reScreenDate.MatchString(name):
		return true
	case reScreenProse.MatchString(name):
		return true
	case reScreenForeign.MatchString(name):
		return true
	case reScreenNonCommon.MatchString(name), reScreenNonCommon.MatchString(r.ShareClass):
		return true
	}
	// A holder name never starts with a lower-case letter; a name that does is
	// the tail of a wrapped prose line.
	if name != "" && name[0] >= 'a' && name[0] <= 'z' {
		return true
	}
	// A fractional share count means the name cell absorbed the shares column,
	// so whatever was read as the percent came from somewhere else.
	if r.Shares != nil && *r.Shares != math.Trunc(*r.Shares) {
		return true
	}
	if r.Percent == nil {
		return false
	}
	// Three or more distinct holders in one table carrying the identical percent
	// is one value broadcast down a mis-aligned column.
	if t != nil && t.pctRepeats[*r.Percent] >= 3 {
		return true
	}
	// shares and percent must imply the same outstanding total as the rest of
	// the table. An order-of-magnitude miss means the two cells are from
	// different columns.
	if t != nil && t.haveMedian && r.Shares != nil && *r.Shares > 0 && *r.Percent > 0 {
		ratio := (*r.Shares / (*r.Percent / 100.0)) / t.medianTotal
		if ratio > 5.0 || ratio < 0.2 {
			return true
		}
	}
	return false
}
