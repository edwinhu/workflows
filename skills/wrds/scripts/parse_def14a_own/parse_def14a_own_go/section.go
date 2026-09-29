package main

import (
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

// Locating the ownership section and labelling each of its tables.

var (
	reOwnHeading = regexp.MustCompile(`(?i)(security\s+ownership|beneficial\s+ownership|ownership\s+of\s+(?:common\s+stock|securities|equity|shares|capital\s+stock)|principal\s+(?:stock|share)holders|principal\s+holders|stock\s+ownership|share\s+ownership|certain\s+beneficial\s+owners|holders\s+of\s+more\s+than\s+five|five\s+percent\s+(?:holders|owners))`)
	reMgmtCue    = regexp.MustCompile(`(?i)management|directors?\s+and\s+(?:executive\s+)?officers?|director\s+and\s+officer`)
	re5pctCue    = regexp.MustCompile(`(?i)certain\s+beneficial\s+owners|principal\s+(?:stock|share)holders|principal\s+holders|five\s+percent|5\s*%|more\s+than\s+five\s+percent|substantial\s+(?:stock|share)holders`)
	reTOCish     = regexp.MustCompile(`\.{4,}|\s\d{1,3}\s*$`)
)

// sectionKind labels a heading. A heading that names both populations, or names
// neither distinctly, yields "combined" and the per-table refinement in
// tableKind decides.
func sectionKind(h string) string {
	m, f := reMgmtCue.MatchString(h), re5pctCue.MatchString(h)
	switch {
	case m && f:
		return "combined"
	case m:
		return "management"
	case f:
		return "5pct_holders"
	default:
		return "combined"
	}
}

// tableKind refines the section label using what the table actually contains:
// a group row means management is in it; institutional/entity holders with no
// group row means it is the 5% table.
func tableKind(sectKind string, rows []Row, tableText string) string {
	hasGroup := false
	for _, r := range rows {
		if r.IsGroupRow {
			hasGroup = true
		}
	}
	fiveCue := re5pctCue.MatchString(tableText)
	switch {
	case hasGroup && fiveCue:
		return "combined"
	case hasGroup:
		// A single table under a heading that names both populations is the
		// combined table; the split case is resolved by the caller, which sees
		// all of a heading's tables at once.
		return sectKind
	case fiveCue:
		return "5pct_holders"
	default:
		return sectKind
	}
}

// seriesLabels walks the document once and records, for every item, the most
// recent text chunk that IS one of the fund / series names the SGML header
// declared. A fund-family proxy repeats the same ownership table once per fund
// and the fund's name stands above it as a plain heading line; without it the
// same record holder collapses onto one grain key across dozens of real,
// distinct per-fund disclosures.
//
// Only a filing declaring two or more series is labelled: with one series there
// is nothing to disambiguate, and an operating company declares none.
func seriesLabels(items []Item, series []string) []string {
	out := make([]string, len(items))
	set := SeriesSet(series)
	if set == nil {
		return out
	}
	cur, at := "", 0
	for i, it := range items {
		if it.Kind == "text" && len(it.Text) <= 120 {
			if v := MatchSeries(set, it.Text); v != "" {
				cur, at = v, i
			}
		}
		// A fund's table follows its name closely. Carrying a label further
		// than that labels an unrelated table with a stale fund.
		if cur != "" && i-at <= seriesReach {
			out[i] = cur
		}
	}
	return out
}

// seriesReach bounds how far a fund label carries from the line that states it,
// in document items (DOM) or lines (ASCII).
const seriesReach = 40

// namesSeries reports whether a label already leads with a declared fund, in
// which case the document-level label must not be prefixed onto it: the more
// local one is right and the outer one may be stale.
func namesSeries(set map[string]string, hint string) bool {
	if set == nil || hint == "" {
		return false
	}
	head := hint
	if i := strings.Index(head, " | "); i >= 0 {
		head = head[:i]
	}
	return MatchSeries(set, head) != ""
}

// withSeries puts the fund identity in front of whatever class label the table
// itself yielded, so "Admiral Shares" of two different funds are two keys.
func withSeries(series, hint string) string {
	switch {
	case series == "":
		return hint
	case hint == "":
		return series
	default:
		return series + " | " + hint
	}
}

func isHeadingChunk(t string) bool {
	if len(t) > 200 || len(t) < 6 {
		return false
	}
	if reTOCish.MatchString(t) {
		return false
	}
	return reOwnHeading.MatchString(t)
}

// ExtractHTML runs the DOM path: find ownership headings, take the tables that
// follow each, and emit rows.
func ExtractHTML(body string, base Row) ([]Row, int, int) {
	doc, err := html.Parse(strings.NewReader(body))
	if err != nil {
		return nil, 0, 0
	}
	items := DocumentItems(doc)
	var out []Row
	tablesSeen, tablesUsed := 0, 0
	used := map[int]bool{}
	seriesAt := seriesLabels(items, base.series)
	sset := SeriesSet(base.series)

	type tres struct {
		rows   []Row
		text   string
		series string
	}
	// The compacted form of the last ACCEPTED table and the item it sat at, so a
	// header-less continuation of it can inherit its columns. Held across
	// headings, because a fund-family proxy puts a heading between per-fund
	// tables; the adjacency window below is what keeps it a continuation.
	var prev *compacted
	consider := func(startIdx int, kind string) {
		misses := 0
		var got []tres
		// The window is counted in tables considered, not items: J&J puts ~120
		// text chunks between its management table and its 5% table.
		considered := 0
		for k := startIdx; k < len(items) && considered < 12; k++ {
			it := items[k]
			if it.Kind == "text" {
				if isHeadingChunk(it.Text) && k > startIdx {
					// a new ownership heading: let its own pass handle it
					break
				}
				continue
			}
			if used[it.Pos] {
				continue
			}
			tablesSeen++
			considered++
			rows, cg := ExtractGrid(it.Grid, it.Text, base, it.Pos, prev)
			if len(rows) == 0 {
				misses++
				if misses >= 6 && len(got) > 0 {
					break
				}
				continue
			}
			used[it.Pos] = true
			tablesUsed++
			// Keep handing on the table that HAS the headers, not a
			// continuation that borrowed them, so a run of header-less
			// continuations all inherit from the same headed table.
			if !cg.inherited {
				prev = cg
			}
			got = append(got, tres{rows, it.Text, seriesAt[k]})
		}
		for _, g := range got {
			kd := tableKind(kind, g.rows, g.text)
			if len(got) > 1 {
				// The heading covers a 5% table and a management table: the one
				// carrying the D&O group row is the management table.
				kd = "5pct_holders"
				for _, r := range g.rows {
					if r.IsGroupRow {
						kd = "management"
						break
					}
				}
			}
			for i := range g.rows {
				g.rows[i].TableKind = kd
				if !g.rows[i].seriesLocal && !namesSeries(sset, g.rows[i].classHint) {
					g.rows[i].classHint = withSeries(g.series, g.rows[i].classHint)
				}
			}
			out = append(out, g.rows...)
		}
	}

	for i, it := range items {
		if it.Kind == "text" && isHeadingChunk(it.Text) {
			consider(i+1, sectionKind(it.Text))
		}
	}
	// Fallback: no heading located the table, so accept any table whose own
	// text carries the ownership cue.
	if len(out) == 0 {
		for fi, it := range items {
			if it.Kind != "table" || used[it.Pos] {
				continue
			}
			if !reOwnCue.MatchString(it.Text) {
				continue
			}
			tablesSeen++
			rows, cg := ExtractGrid(it.Grid, it.Text, base, it.Pos, prev)
			if len(rows) == 0 {
				continue
			}
			used[it.Pos] = true
			tablesUsed++
			if !cg.inherited {
				prev = cg
			}
			kd := tableKind("combined", rows, it.Text)
			for i := range rows {
				rows[i].TableKind = kd
				if !rows[i].seriesLocal && !namesSeries(sset, rows[i].classHint) {
					rows[i].classHint = withSeries(seriesAt[fi], rows[i].classHint)
				}
			}
			out = append(out, rows...)
		}
	}
	return out, tablesSeen, tablesUsed
}
