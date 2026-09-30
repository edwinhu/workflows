package main

// The pre-2001 path: a prospectus whose body is plain ASCII with <TABLE>/<S>/<C>
// column markers and not one <TR>. 515 of the 2,226 VC-backed IPOs in the target
// window priced before 2001 (design profile, P3), so this is a quarter of the
// sample, not an edge case.
//
// This is a NEW row parser, deliberately not a port of def14a's textfallback.go.
// That parser is built for share counts and percentages: `commaNums` keeps only
// thousands-separated tokens and throws bare two-digit numbers away, and its
// director-bio guard REJECTS any age-bearing line as "a director profile, not a
// holder row" (profile, P6). Here the bare two-digit number is the signal and the
// age-bearing line is the row we want, so the two are inverted, not mistuned.
//
// Geometry, from eBay's 1998 424B4:
//
//	   NAME                   AGE                           POSITION
//	   ----                   ---                           --------
//	<S>                       <C> <C>
//	Pierre M. Omidyar.......   31 Founder, Chairman of the Board and a director
//	Scott D. Cook (1).......   45 Director
//
// The name is padded to a fixed column with dot leaders, committee markers sit
// OUTSIDE the leaders, the age is right-aligned in a narrow field and the
// position starts at a fixed column.

import (
	"regexp"
	"strings"
)

var (
	// The ASCII table and pagination markers, which carry no text.
	reTxtTag = regexp.MustCompile(`(?i)</?(?:TABLE|CAPTION|S|C|PRE|PAGE|FN)>`)
	// A rule line: dashes and spaces, nothing else. EDGAR writes "- --------"
	// at the top level because a leading "-" would start a new SGML tag.
	reRuleLine = regexp.MustCompile(`^[-=_\s]+$`)
	// The fixed-width header: all three column names on one line.
	reTxtHeader = regexp.MustCompile(`(?i)\bNAME\b.*\bAGE\b.*\b(?:POSITION|TITLE|OFFICE)S?\b`)
	// A bare two-digit number standing alone in the line: the age.
	reTxtAge = regexp.MustCompile(`(^|\s)([0-9]{2})(\s|$)`)
)

// asciiLine strips the SGML table markers from one line without changing its
// column geometry, which the parser depends on. A marker is replaced by spaces of
// the same width rather than removed.
func asciiLine(s string) string {
	s = strings.ReplaceAll(s, "\r", "")
	return reTxtTag.ReplaceAllStringFunc(s, func(m string) string {
		return strings.Repeat(" ", len(m))
	})
}

// asciiSection returns the line range of the MANAGEMENT section and the index of
// its fixed-width header line.
func asciiSection(lines []string) (lo, hi, hdr int, status string) {
	status = StatusNoMgmtSection
	for i, raw := range lines {
		s := strings.TrimSpace(asciiLine(raw))
		if !isMgmtHeading(s) {
			continue
		}
		status = StatusNoMgmtTable
		end := len(lines)
		found := -1
		for j := i + 1; j < end; j++ {
			t := strings.TrimSpace(asciiLine(lines[j]))
			if found < 0 && reTxtHeader.MatchString(t) {
				found = j
				continue
			}
			if closesSection(t) {
				end = j
				break
			}
		}
		if found >= 0 {
			return i, end, found, StatusOK
		}
	}
	return 0, 0, -1, status
}

// asciiRows parses the fixed-width table body. The age's column in the header row
// anchors the split, and the age itself is what identifies a person row.
func asciiRows(lines []string, hdr, hi int) (rows []mgmtRow, bodyEnd int) {
	hdrLine := asciiLine(lines[hdr])
	anchor := strings.Index(strings.ToUpper(hdrLine), "AGE")

	blanks := 0
	for i := hdr + 1; i < hi; i++ {
		line := asciiLine(lines[i])
		t := strings.TrimSpace(line)
		if t == "" {
			// Two blank lines after at least one row is the end of the table in
			// filings that omit </TABLE>.
			blanks++
			if len(rows) > 0 && blanks >= 2 {
				return rows, i
			}
			continue
		}
		blanks = 0
		if reRuleLine.MatchString(t) {
			continue
		}
		if strings.HasPrefix(t, "(") && len(rows) > 0 {
			// Committee footnotes sit under the table.
			return rows, i
		}
		if lo, hiIdx, ok := pickAge(line, anchor); ok {
			name := strings.TrimSpace(line[:lo])
			if name == "" {
				continue
			}
			age, _ := plausibleAge(line[lo:hiIdx])
			rows = append(rows, mgmtRow{
				NameRaw:  name,
				Name:     normName(name),
				Age:      age,
				Position: strings.TrimSpace(line[hiIdx:]),
			})
			continue
		}
		// No age on the line. Before the first row it is still header furniture;
		// after it, a short line is a section label and a long one means the
		// table has ended and the bios have started.
		if len(rows) == 0 {
			continue
		}
		if len(t) <= 70 && !strings.HasSuffix(t, ".") {
			rows = append(rows, mgmtRow{Label: t})
			continue
		}
		return rows, i
	}
	return rows, hi
}

// pickAge finds the age field in a fixed-width row: the bare two-digit number
// whose column is nearest the header's AGE column. Nearest, not first, is what
// keeps a two-digit number inside a long position string ("Vice President, Region
// 12") from being read as somebody's age.
func pickAge(line string, anchor int) (lo, hi int, ok bool) {
	best := -1
	for _, m := range reTxtAge.FindAllStringSubmatchIndex(line, -1) {
		s, e := m[4], m[5] // the capture group holding the digits
		if _, plausible := plausibleAge(line[s:e]); !plausible {
			continue
		}
		if anchor < 0 {
			return s, e, true
		}
		if best < 0 || absInt(s-anchor) < absInt(best-anchor) {
			best, lo, hi = s, s, e
		}
	}
	if best < 0 {
		return 0, 0, false
	}
	// A column that far from the header's is not the age field.
	if anchor >= 0 && absInt(best-anchor) > 12 {
		return 0, 0, false
	}
	return lo, hi, true
}

func absInt(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// asciiParagraphs turns the lines after the table into the prose blocks the bio
// splitter consumes: hard-wrapped lines rejoined, blank-line separated, page
// furniture dropped.
func asciiParagraphs(lines []string, lo, hi int) []string {
	var out []string
	var cur []string
	flush := func() {
		if len(cur) == 0 {
			return
		}
		p := norm(strings.Join(cur, " "))
		cur = cur[:0]
		if p != "" && !isPageFurniture(p) {
			out = append(out, p)
		}
	}
	for i := lo; i < hi && i < len(lines); i++ {
		t := strings.TrimSpace(asciiLine(lines[i]))
		if t == "" || reRuleLine.MatchString(t) {
			flush()
			continue
		}
		if isPageFurniture(t) {
			flush()
			continue
		}
		cur = append(cur, t)
	}
	flush()
	return out
}

// extractASCII is the fixed-width counterpart of extractHTML.
func extractASCII(body, issuer string) Extraction {
	lines := strings.Split(body, "\n")
	_, hi, hdr, status := asciiSection(lines)
	if status != StatusOK {
		return Extraction{Filing: FilingSummary{Status: status}}
	}
	rows, bodyEnd := asciiRows(lines, hdr, hi)
	persons := buildPersons(rows)
	if len(persons) == 0 {
		return Extraction{Filing: FilingSummary{Status: StatusNoMgmtTable}}
	}
	attachBios(persons, asciiParagraphs(lines, bodyEnd, hi))
	return finish(persons, issuer)
}
