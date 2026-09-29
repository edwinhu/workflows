package main

// Finding the MANAGEMENT section of a prospectus, and deciding which table
// inside it is the Name / Age / Position table.
//
// Everything downstream is bounded to the span this file returns. That bound is
// load-bearing, not tidiness: Google's 424B4 appends the roadshow transcript and
// a Playboy interview, and both say "CEO" and "founder" (design profile, R4). A
// document-wide search for either token reads the interview as governance data.

import (
	"regexp"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

type blockKind uint8

const (
	blockText blockKind = iota
	blockTable
)

// docBlock is one element of the document-order stream the section finder walks.
// InTable marks text that came from inside a data table, which is prose for no
// one: it is the table's own cells.
type docBlock struct {
	Kind    blockKind
	Text    string
	Grid    *Grid
	InTable bool
}

// docBlocks flattens the DOM into text blocks and data tables in document order.
//
// grid.go's DocumentItems cannot serve here. It descends into a data table after
// emitting it, so every cell reappears in the text stream — and a bio splitter
// keyed on the table's own name list would then read each name cell as the start
// of that person's bio and assign the next cell (an age) as the bio. Marking the
// interior instead keeps both readings available from one pass. A table under
// 2x2 is layout, not data: its text is folded into the stream where headings
// live, exactly as DocumentItems does it.
func docBlocks(doc *html.Node) []docBlock {
	var out []docBlock
	var buf strings.Builder
	depth := 0
	flush := func() {
		t := norm(buf.String())
		buf.Reset()
		if t != "" {
			out = append(out, docBlock{Kind: blockText, Text: t, InTable: depth > 0})
		}
	}
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		switch n.Type {
		case html.TextNode:
			buf.WriteString(n.Data)
			buf.WriteString(" ")
			return
		case html.ElementNode:
			if n.DataAtom == atom.Script || n.DataAtom == atom.Style {
				return
			}
			if n.DataAtom == atom.Table {
				g := buildGrid(n)
				data := len(g.Rows) >= 2 && g.NCol() >= 2
				flush()
				if data {
					out = append(out, docBlock{Kind: blockTable, Grid: g, InTable: depth > 0})
					depth++
				}
				for c := n.FirstChild; c != nil; c = c.NextSibling {
					walk(c)
				}
				if data {
					depth--
				}
				flush()
				return
			}
			if blockAtoms[n.DataAtom] {
				flush()
			}
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c)
			}
			if blockAtoms[n.DataAtom] {
				flush()
			}
			return
		default:
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c)
			}
		}
	}
	walk(doc)
	flush()
	return out
}

// ---------------------------------------------------------------------------
// headings
// ---------------------------------------------------------------------------

var (
	// The section openers measured across the seven profiled filings: a bare
	// MANAGEMENT, or the sub-heading that introduces the table when the filing
	// runs the two together.
	reMgmtHeading = regexp.MustCompile(`(?i)^(?:our\s+)?management(?:\s+team)?$|` +
		`^management\s+and\s+(?:board|other)|` +
		`^(?:our\s+)?(?:executive\s+officers|executive\s+officers\s+and\s+directors|` +
		`directors\s+and\s+executive\s+officers|directors,?\s+executive\s+officers)\b`)

	// Sub-headings that live INSIDE the section and must never close it.
	reMgmtSubHeading = regexp.MustCompile(`(?i)^(?:our\s+)?(?:management|executive\s+officers|` +
		`non-?employee\s+directors|other\s+key\s+employees|key\s+employees|directors|` +
		`continuing\s+directors|director\s+nominees|board\s+of\s+directors|` +
		`executive\s+officers\s+and\s+directors|directors\s+and\s+executive\s+officers|` +
		`senior\s+management|other\s+executive\s+officers)\b`)

	// The top-level prospectus sections that follow MANAGEMENT, plus the two
	// appendices Google's 424B4 carries after the prospectus proper.
	reSectionEnd = regexp.MustCompile(`(?i)^(?:executive\s+compensation|` +
		`compensation\s+discussion|director\s+compensation|principal\s+(?:and\s+selling\s+)?stockholders|` +
		`principal\s+(?:and\s+selling\s+)?shareholders|security\s+ownership|` +
		`certain\s+relationships|related\s+part(?:y|ies)\s+transactions|` +
		`description\s+of\s+capital\s+stock|description\s+of\s+securities|` +
		`shares\s+eligible\s+for\s+future\s+sale|underwrit(?:ing|ers)|` +
		`material\s+(?:u\.?s\.?|united\s+states)\s+federal|legal\s+matters|experts|` +
		`where\s+you\s+can\s+find|index\s+to\s+(?:consolidated\s+)?financial\s+statements|` +
		`transcript\b|playboy\b|report\s+of\s+independent)`)

	reAllDigits = regexp.MustCompile(`^[0-9]{1,4}$`)
	reHasLetter = regexp.MustCompile(`[A-Za-z]`)
)

// headingShaped reports whether a text block reads as a title rather than prose:
// short, no sentence-ending period, and at least a couple of letters. It is the
// gate every heading test below runs behind, so a sentence that happens to start
// with "Management" cannot open or close a section.
func headingShaped(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 90 || !reHasLetter.MatchString(s) {
		return false
	}
	if strings.HasSuffix(s, ".") && !strings.HasSuffix(s, "Inc.") {
		return false
	}
	// A title has no internal sentence breaks.
	return !strings.Contains(s, ". ") && strings.Count(s, ",") <= 2
}

// shouty reports whether a heading is set in capitals, which in these filings is
// how a top-level section announces itself.
func shouty(s string) bool {
	up, lo := 0, 0
	for _, r := range s {
		switch {
		case r >= 'A' && r <= 'Z':
			up++
		case r >= 'a' && r <= 'z':
			lo++
		}
	}
	return up >= 2 && up*4 >= (up+lo)*3
}

func isMgmtHeading(s string) bool {
	return headingShaped(s) && reMgmtHeading.MatchString(strings.TrimSpace(s))
}

// closesSection reports whether a heading ends the MANAGEMENT section: a named
// top-level successor, or any all-capitals heading that is not one of the
// section's own sub-headings.
func closesSection(s string) bool {
	s = strings.TrimSpace(s)
	if !headingShaped(s) {
		return false
	}
	if reMgmtSubHeading.MatchString(s) {
		return false
	}
	return reSectionEnd.MatchString(s) || shouty(s)
}

// isPageFurniture reports whether a block is a page break's residue rather than
// content: a bare page number, or the "Table of Contents" link EDGAR HTML puts
// at the top of every page. Uber's CEO bio is interrupted by both (profile, R6).
func isPageFurniture(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || reAllDigits.MatchString(s) {
		return true
	}
	l := strings.ToLower(s)
	return l == "table of contents" || l == "table of contents." ||
		(strings.HasPrefix(l, "table of contents ") && len(s) < 40)
}

// ---------------------------------------------------------------------------
// the management table predicate
// ---------------------------------------------------------------------------

var (
	reHdrAge = regexp.MustCompile(`(?i)^age\b`)
	reHdrPos = regexp.MustCompile(`(?i)^(?:position|title|office)s?\b`)
	reAge    = regexp.MustCompile(`^[0-9]{2}$`)
)

// plausibleAge is the two-digit-integer test Design rule 1 keys the table
// predicate on and Design rule 1's column mapping keys the Age column on.
func plausibleAge(cell string) (int, bool) {
	c := strings.TrimSpace(flat(cell))
	if !reAge.MatchString(c) {
		return 0, false
	}
	n := int(c[0]-'0')*10 + int(c[1]-'0')
	if n < 18 || n > 99 {
		return 0, false
	}
	return n, true
}

// mgmtHeaderRow returns the index of the grid's header row, which is the first
// row naming both Age and a Position/Title column. -1 when there is none.
func mgmtHeaderRow(g *Grid) int {
	limit := len(g.Rows)
	if limit > 6 {
		limit = 6
	}
	for i := 0; i < limit; i++ {
		age, pos := false, false
		for _, c := range g.Rows[i] {
			f := strings.TrimSpace(flat(c))
			if reHdrAge.MatchString(f) {
				age = true
			}
			if reHdrPos.MatchString(f) {
				pos = true
			}
		}
		if age && pos {
			return i
		}
	}
	return -1
}

// isMgmtTable applies Design rule 1: the header names Age and Position/Title,
// the table has at least three BODY rows under that header, and at least half of
// those carry a bare two-digit number somewhere.
//
// The row-count and numeric-age conditions are what remove the false positives
// the profile measured — 5 header-word matches in Facebook, 13 in Uber, 8 in
// Netflix, one real table each. The three counted rows are body rows, not rows
// including the header: a compensation summary carries Name/Age-shaped headers
// over two rows, and accepting it ahead of the real officer table would give the
// filing the wrong person set.
func isMgmtTable(g *Grid) (hdr int, ok bool) {
	if g == nil || len(g.Rows) < 3 {
		return -1, false
	}
	hdr = mgmtHeaderRow(g)
	if hdr < 0 {
		return -1, false
	}
	body, aged := 0, 0
	for i := hdr + 1; i < len(g.Rows); i++ {
		if rowIsEmpty(g.Rows[i]) {
			continue
		}
		body++
		for _, c := range g.Rows[i] {
			if _, okAge := plausibleAge(c); okAge {
				aged++
				break
			}
		}
	}
	if body < 3 || aged == 0 || aged*2 < body {
		return -1, false
	}
	return hdr, true
}

func rowIsEmpty(row []string) bool {
	for _, c := range row {
		if strings.TrimSpace(flat(c)) != "" {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// the section span
// ---------------------------------------------------------------------------

// maxSectionBlocks bounds how far past the MANAGEMENT heading the scan will read
// when no closing heading is ever found. The seven profiled filings need 60-130
// blocks; this is a runaway guard, not a tuning knob.
const maxSectionBlocks = 800

// mgmtSection locates the MANAGEMENT section and its Name/Age/Position table.
// tableIdx is the index in blocks of the chosen table; lo/hi bound the section.
func mgmtSection(blocks []docBlock) (lo, hi, tableIdx, hdrRow int, status string) {
	for i, b := range blocks {
		if b.Kind != blockText || b.InTable || !isMgmtHeading(b.Text) {
			continue
		}
		lo = i
		hi = len(blocks)
		if lo+maxSectionBlocks < hi {
			hi = lo + maxSectionBlocks
		}
		tableIdx, hdrRow = -1, -1
		for j := i + 1; j < hi; j++ {
			if blocks[j].Kind == blockText && !blocks[j].InTable && closesSection(blocks[j].Text) {
				hi = j
				break
			}
			if tableIdx < 0 && blocks[j].Kind == blockTable {
				if h, ok := isMgmtTable(blocks[j].Grid); ok {
					tableIdx, hdrRow = j, h
				}
			}
		}
		if tableIdx >= 0 {
			return lo, hi, tableIdx, hdrRow, StatusOK
		}
		// A heading with no table under it: keep looking, a later MANAGEMENT
		// heading (the table of contents names one too) may carry the table.
		status = StatusNoMgmtTable
	}
	if status == StatusNoMgmtTable {
		return 0, 0, -1, -1, StatusNoMgmtTable
	}
	return 0, 0, -1, -1, StatusNoMgmtSection
}
