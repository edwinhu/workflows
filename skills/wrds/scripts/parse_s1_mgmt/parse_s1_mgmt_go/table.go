package main

// Reading the Name / Age / Position table: which column holds which role, which
// rows are people and which are section labels, and how a name cell normalises.
//
// Columns are identified by CONTENT, never by header index. Facebook, Snap and
// Uber set the header cells with a colspan that covers the spacer columns while
// the body cells do not, so the header's "Age" lands at grid column 2 and every
// body age at column 3 (design profile, P4). A parser that maps by header index
// reads every age as empty on three of the seven filings.

import (
	"regexp"
	"strings"
)

// colRoles is the content-derived column map for one management grid.
type colRoles struct {
	name int
	age  int
	pos  int
}

// columnRoles locates the three columns by what their body cells hold: the Age
// column is the one whose cells are bare two-digit integers, Name is the
// left-most text column beside it, and Position is the widest remaining one.
func columnRoles(g *Grid, hdr int) (colRoles, bool) {
	ncol := g.NCol()
	if ncol == 0 {
		return colRoles{}, false
	}
	ages := make([]int, ncol)
	texts := make([]int, ncol)  // total text length in body rows
	filled := make([]int, ncol) // non-empty body cells
	for i := hdr + 1; i < len(g.Rows); i++ {
		if rowIsEmpty(g.Rows[i]) {
			continue
		}
		for j := 0; j < ncol; j++ {
			c := strings.TrimSpace(flat(g.At(i, j)))
			if c == "" {
				continue
			}
			filled[j]++
			texts[j] += len(c)
			if _, ok := plausibleAge(c); ok {
				ages[j]++
			}
		}
	}

	age := -1
	for j := 0; j < ncol; j++ {
		if ages[j] > 0 && (age < 0 || ages[j] > ages[age]) {
			age = j
		}
	}
	if age < 0 {
		return colRoles{}, false
	}

	// Name: the left-most column that is mostly non-age text. Prefer a column
	// left of Age (every layout in circulation puts the name first) and fall
	// back to the right of it rather than giving up.
	name := -1
	for j := 0; j < ncol; j++ {
		if j == age || filled[j] == 0 || ages[j]*2 > filled[j] {
			continue
		}
		if j < age {
			name = j
			break
		}
		if name < 0 {
			name = j
		}
	}
	if name < 0 {
		return colRoles{}, false
	}

	// Position: the widest remaining text column, preferring one to the right of
	// the Age column.
	pos := -1
	for _, right := range []bool{true, false} {
		for j := 0; j < ncol; j++ {
			if j == age || j == name || filled[j] == 0 {
				continue
			}
			if right != (j > age) {
				continue
			}
			if pos < 0 || texts[j] > texts[pos] {
				pos = j
			}
		}
		if pos >= 0 {
			break
		}
	}
	if pos < 0 {
		return colRoles{}, false
	}
	return colRoles{name: name, age: age, pos: pos}, true
}

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

// mgmtRow is one body row: either a person or the section label that governs the
// rows beneath it.
type mgmtRow struct {
	NameRaw  string
	Name     string
	Age      int
	Position string
	Label    string // non-empty on a section row, and then the other fields are unset
}

var reLeadingMarker = regexp.MustCompile(`^\s*\(`)

// gridRows walks the body of the management grid. Design rule 2: a row with an
// empty Age cell is a section row and labels the rows beneath it.
func gridRows(g *Grid, hdr int, c colRoles) []mgmtRow {
	var out []mgmtRow
	for i := hdr + 1; i < len(g.Rows); i++ {
		if rowIsEmpty(g.Rows[i]) {
			continue
		}
		nameCell := strings.TrimSpace(flat(g.At(i, c.name)))
		if nameCell == "" {
			continue
		}
		if age, ok := plausibleAge(g.At(i, c.age)); ok {
			out = append(out, mgmtRow{
				NameRaw:  nameCell,
				Name:     normName(nameCell),
				Age:      age,
				Position: strings.TrimSpace(flat(g.At(i, c.pos))),
			})
			continue
		}
		// A section label: short, not a committee footnote, and not the
		// continuation of a wrapped position cell.
		if len(nameCell) <= 70 && !reLeadingMarker.MatchString(nameCell) {
			out = append(out, mgmtRow{Label: nameCell})
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// name normalisation (Design rule 3)
// ---------------------------------------------------------------------------

var (
	reDotLeader  = regexp.MustCompile(`\.{2,}\s*$`)
	reFootMarker = regexp.MustCompile(`(?:\s*\((?:[0-9]{1,2}|[a-zA-Z])\))+\s*$`)
	reStarMarker = regexp.MustCompile(`[*\x{2020}\x{2021}#§\x{00b6}]+\s*$`)
	reTrailPunct = regexp.MustCompile(`[\s,;:]+$`)

	// A post-nominal DEGREE, hung off the end of the name cell. It is not part
	// of the name: the same filing's bio prints the person with a different set
	// of letters or none at all ("Rob Hopfner, R.Ph., Ph.D." in the table,
	// "Dr. Hopfner" in the bio). Generational suffixes — Jr, Sr, III — are
	// deliberately absent, because those ARE the name. Anchored to the tail and
	// requiring a comma or space in front so a surname is never eaten.
	reDegreeTail = regexp.MustCompile(`(?i)[,\s]+(?:Ph\.?\s*D|M\.?B\.?A|M\.?D|D\.?V\.?M|` +
		`Pharm\.?\s*D|D\.?Phil|Sc\.?D|D\.?Sc|M\.?Sc|M\.?P\.?H|LL\.?[BM]|J\.?D|` +
		`C\.?F\.?A|C\.?P\.?A|C\.?F\.?P|R\.?Ph|D\.?D\.?S|Esq)\.?$`)
)

// normName strips the dot leaders a fixed-width table pads a name with and the
// committee footnote markers every filing glues to it — "(1)(2)", "*",
// "Scott D. Cook (1)......." — and the post-nominal degrees it hangs off the
// end. NameRaw keeps the cell as the filing wrote it.
func normName(raw string) string {
	s := flat(raw)
	for {
		before := s
		s = reDotLeader.ReplaceAllString(s, "")
		s = reFootMarker.ReplaceAllString(s, "")
		s = reStarMarker.ReplaceAllString(s, "")
		s = reDegreeTail.ReplaceAllString(s, "")
		s = reTrailPunct.ReplaceAllString(s, "")
		if s == before {
			return strings.TrimSpace(s)
		}
	}
}

// ---------------------------------------------------------------------------
// officer / director / key employee
// ---------------------------------------------------------------------------

var (
	reLblKeyEmp = regexp.MustCompile(`(?i)key\s+(?:employee|personnel)|other\s+key`)
	// \bdirectors?\b unanchored is deliberate: it is what makes Netflix's
	// "Executive Officers and Directors" match BOTH sides and so settle nothing,
	// which is the only correct reading of a label that opens a block holding
	// four officers and six directors.
	reLblDir = regexp.MustCompile(`(?i)\bdirectors?\b|\btrustees?\b`)
	reLblOff = regexp.MustCompile(`(?i)executive\s+officers?|senior\s+management|` +
		`management\s+team|named\s+executive`)

	// An executive office, which settles officer-vs-director when the filing
	// carries no section rows at all (Google, Facebook).
	// Up to three words, and "&" counted as one of them, because 2021 titles
	// run long: "Chief Strategy and Development Officer", "Chief Experience &
	// Innovation Officer", "Chief Medical and Quality Officer". The same span
	// closing on "counsel" is NuVasive's "Chief Patent Counsel".
	rePosOfficer = regexp.MustCompile(`(?i)\bchief\s+(?:[a-z&]+\s+){1,3}(?:officer|counsel)\b|` +
		`\bchief\s+executive\b|\bC\.?E\.?O\.?\b|\bC\.?F\.?O\.?\b|\bC\.?O\.?O\.?\b|\bC\.?T\.?O\.?\b|` +
		`\bpresident\b|\bvice\s+president\b|\bgeneral\s+counsel\b|\bsecretary\b|\btreasurer\b|` +
		`\bcontroller\b|\bgeneral\s+manager\b|\bhead\s+of\b|\bchief\s+of\s+staff\b|` +
		`\bprincipal\s+(?:accounting|financial)\s+officer\b|\bexecutive\s+chair`)
	// \bboard\s+members?\b is Beyond Meat's spelling of every board seat: the
	// Position cell reads "Board Member" and never the word "director".
	rePosDirector = regexp.MustCompile(`(?i)\bdirectors?\b|\bchairman\b|\bchairperson\b|` +
		`\bchair\s+of\s+the\s+board\b|\btrustee\b|\bboard\s+members?\b`)
)

// sectionForLabel maps a section row's text to the block it opens. "" means the
// label names both officers and directors (Netflix's "Executive Officers and
// Directors"), which settles nothing and hands the rows beneath it to the
// Position-text fallback.
func sectionForLabel(label string) string {
	l := strings.TrimSpace(label)
	switch {
	case reLblKeyEmp.MatchString(l):
		return SectionKeyEmployee
	case reLblOff.MatchString(l) && reLblDir.MatchString(l):
		return ""
	case reLblDir.MatchString(l):
		return SectionDirector
	case reLblOff.MatchString(l):
		return SectionOfficer
	}
	return ""
}

// sectionForPosition classifies from the Position cell. An executive office wins
// over a board seat, because most officers also sit on the board and the filing
// writes both into one cell: Google's Schmidt is "Chairman of the Executive
// Committee, Chief Executive Officer and Director" and is an officer.
func sectionForPosition(pos string) string {
	switch {
	case rePosOfficer.MatchString(pos):
		return SectionOfficer
	case rePosDirector.MatchString(pos):
		return SectionDirector
	}
	return SectionUnknown
}

// buildPersons turns the grid's rows into person records, applying Design rule
// 2: a section row labels the rows beneath it, and a Key Employees label is not
// negotiable — Netflix's Marc Randolph is a co-founder sitting in that block and
// a Position-text reading would file him as an officer.
func buildPersons(rows []mgmtRow) []Person {
	var out []Person
	current := ""
	seq := 0
	for _, r := range rows {
		if r.Label != "" {
			current = sectionForLabel(r.Label)
			continue
		}
		sec := current
		if sec == "" {
			sec = sectionForPosition(r.Position)
		}
		seq++
		out = append(out, Person{
			Seq:      seq,
			NameRaw:  r.NameRaw,
			Name:     r.Name,
			Age:      r.Age,
			Position: r.Position,
			Section:  sec,
		})
	}
	return out
}
