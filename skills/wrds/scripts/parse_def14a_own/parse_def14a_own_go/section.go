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

	type tres struct {
		rows []Row
		text string
	}
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
			rows := ExtractGrid(it.Grid, it.Text, base, it.Pos)
			if len(rows) == 0 {
				misses++
				if misses >= 6 && len(got) > 0 {
					break
				}
				continue
			}
			used[it.Pos] = true
			tablesUsed++
			got = append(got, tres{rows, it.Text})
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
		for _, it := range items {
			if it.Kind != "table" || used[it.Pos] {
				continue
			}
			if !reOwnCue.MatchString(it.Text) {
				continue
			}
			tablesSeen++
			rows := ExtractGrid(it.Grid, it.Text, base, it.Pos)
			if len(rows) == 0 {
				continue
			}
			used[it.Pos] = true
			tablesUsed++
			kd := tableKind("combined", rows, it.Text)
			for i := range rows {
				rows[i].TableKind = kd
			}
			out = append(out, rows...)
		}
	}
	return out, tablesSeen, tablesUsed
}
