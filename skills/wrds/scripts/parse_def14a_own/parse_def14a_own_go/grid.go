package main

import (
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// HTML DOM -> rectangular grids, plus a document-order stream of text chunks and
// tables. Stripping tags before parsing destroys the row/column structure the
// whole extraction depends on (the regex director parser scored R 0.245 against
// 0.813 for the DOM version in board-structuring), so nothing here ever sees a
// tag-stripped string.

var (
	reWS     = regexp.MustCompile(`\s+`)
	reSpaces = regexp.MustCompile(`[ \t\r]+`)
	reNLs    = regexp.MustCompile(`\n[ \t]*`)
)

// charFix folds the characters EDGAR HTML uses for spacing and punctuation.
// The non-breaking space matters most: a cell holding only &#160; must read as
// empty, or every spacer column survives compaction as a data column.
var charFix = strings.NewReplacer(
	" ", " ", " ", " ", " ", " ", "​", "",
	"’", "'", "‘", "'", "“", "\"", "”", "\"",
	"–", "-", "—", "-", "−", "-", "•", " ",
)

// normLines collapses horizontal whitespace but keeps the block boundaries a
// cell's <div>/<br> structure marks, because a 5% holder's cell is "name" on
// the first line and a mailing address on the rest.
func normLines(s string) string {
	s = charFix.Replace(s)
	s = reSpaces.ReplaceAllString(s, " ")
	s = reNLs.ReplaceAllString(s, "\n")
	for strings.Contains(s, "\n\n") {
		s = strings.ReplaceAll(s, "\n\n", "\n")
	}
	return strings.Trim(s, " \n")
}

// flat is the single-line view of a cell, used for every parse and role test.
func flat(s string) string { return norm(strings.ReplaceAll(s, "\n", " ")) }

func norm(s string) string {
	s = strings.ReplaceAll(s, " ", " ")
	s = strings.ReplaceAll(s, "’", "'")
	s = strings.ReplaceAll(s, "–", "-")
	s = strings.ReplaceAll(s, "—", "-")
	s = strings.ReplaceAll(s, "•", " ")
	return strings.TrimSpace(reWS.ReplaceAllString(s, " "))
}

func textOf(n *html.Node) string { return flat(textOfLines(n)) }

func textOfLines(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(x *html.Node) {
		if x.Type == html.TextNode {
			b.WriteString(x.Data)
			return
		}
		if x.Type == html.ElementNode && (x.DataAtom == atom.Br || x.DataAtom == atom.Td ||
			x.DataAtom == atom.Th || x.DataAtom == atom.P || x.DataAtom == atom.Div ||
			x.DataAtom == atom.Tr) {
			b.WriteString("\n")
		}
		for c := x.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return normLines(b.String())
}

// Grid is one <table> with colspan/rowspan expanded to a rectangle.
type Grid struct {
	Rows  [][]string
	Depth int
	Pos   int // document order
}

func (g *Grid) NCol() int {
	m := 0
	for _, r := range g.Rows {
		if len(r) > m {
			m = len(r)
		}
	}
	return m
}

func (g *Grid) At(i, j int) string {
	if i < 0 || i >= len(g.Rows) || j < 0 || j >= len(g.Rows[i]) {
		return ""
	}
	return g.Rows[i][j]
}

func attrInt(n *html.Node, key string, def int) int {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, key) {
			if v, err := strconv.Atoi(strings.TrimSpace(a.Val)); err == nil && v >= 1 && v <= 200 {
				return v
			}
			return def
		}
	}
	return def
}

func buildGrid(table *html.Node) *Grid {
	type key struct{ i, j int }
	occ := map[key]string{}
	i := 0
	var rowsOf func(*html.Node)
	rowsOf = func(n *html.Node) {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type != html.ElementNode {
				continue
			}
			switch c.DataAtom {
			case atom.Thead, atom.Tbody, atom.Tfoot:
				rowsOf(c)
			case atom.Tr:
				j := 0
				for cell := c.FirstChild; cell != nil; cell = cell.NextSibling {
					if cell.Type != html.ElementNode || (cell.DataAtom != atom.Td && cell.DataAtom != atom.Th) {
						continue
					}
					for {
						if _, ok := occ[key{i, j}]; !ok {
							break
						}
						j++
					}
					cs := attrInt(cell, "colspan", 1)
					rs := attrInt(cell, "rowspan", 1)
					txt := textOfLines(cell)
					for di := 0; di < rs; di++ {
						for dj := 0; dj < cs; dj++ {
							occ[key{i + di, j + dj}] = txt
						}
					}
					j += cs
				}
				i++
			case atom.Table:
				// nested table: emitted separately by iterTables
			default:
				rowsOf(c)
			}
		}
	}
	rowsOf(table)
	if len(occ) == 0 {
		return &Grid{}
	}
	nrow, ncol := 0, 0
	for k := range occ {
		if k.i+1 > nrow {
			nrow = k.i + 1
		}
		if k.j+1 > ncol {
			ncol = k.j + 1
		}
	}
	rows := make([][]string, nrow)
	for r := 0; r < nrow; r++ {
		rows[r] = make([]string, ncol)
		for c := 0; c < ncol; c++ {
			rows[r][c] = occ[key{r, c}]
		}
	}
	return &Grid{Rows: rows}
}

// Item is one element of the document-order stream the section finder walks.
type Item struct {
	Kind string // "text" | "table"
	Text string
	Grid *Grid
	Pos  int
}

var blockAtoms = map[atom.Atom]bool{
	atom.P: true, atom.Div: true, atom.Br: true, atom.Tr: true, atom.Table: true,
	atom.H1: true, atom.H2: true, atom.H3: true, atom.H4: true, atom.H5: true,
	atom.H6: true, atom.Li: true, atom.Hr: true, atom.Center: true, atom.Td: true,
}

// DocumentItems flattens the DOM into text chunks and tables in document order.
// A table with fewer than 2 rows or 2 columns is layout, not data, so its text
// is folded into the text stream where headings live.
func DocumentItems(doc *html.Node) []Item {
	return documentItems(doc, false)
}

func documentItems(doc *html.Node, includeSingleton bool) []Item {
	var items []Item
	var buf strings.Builder
	pos := 0
	flush := func() {
		t := norm(buf.String())
		buf.Reset()
		if t != "" {
			items = append(items, Item{Kind: "text", Text: t, Pos: pos})
			pos++
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
				if (len(g.Rows) >= 2 || includeSingleton && len(g.Rows) == 1) && g.NCol() >= 2 {
					flush()
					g.Pos = pos
					items = append(items, Item{Kind: "table", Grid: g, Text: textOf(n), Pos: pos})
					pos++
					// still descend, to pick up nested tables and headings
					for c := n.FirstChild; c != nil; c = c.NextSibling {
						walk(c)
					}
					flush()
					return
				}
				// layout table: its text belongs to the heading stream
				flush()
				for c := n.FirstChild; c != nil; c = c.NextSibling {
					walk(c)
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
	return items
}

var (
	rePositionIndent  = regexp.MustCompile(`(?i)(?:^|;)\s*text-indent\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*(pt|in)\b`)
	rePositionOverlap = regexp.MustCompile(`(?i)(?:^|;)\s*margin-bottom\s*:\s*-[0-9]+(?:\.[0-9]+)?\s*pt\b`)
)

// positionedOwnershipItems reconstructs columns made from overlapping paragraphs,
// only for the zero-filing retry. Numeric paragraphs must share the name's line
// and occupy successively greater indents under explicit ownership headers.
func positionedOwnershipItems(doc *html.Node, firstPos int) []Item {
	type paragraph struct {
		text    string
		indent  float64
		overlap bool
	}
	var ps []paragraph
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			if n.DataAtom == atom.Table || n.DataAtom == atom.Script || n.DataAtom == atom.Style {
				return
			}
			if n.DataAtom == atom.P {
				p := paragraph{text: textOf(n)}
				for _, a := range n.Attr {
					if a.Key == "style" {
						p.overlap = rePositionOverlap.MatchString(a.Val)
						if m := rePositionIndent.FindStringSubmatch(a.Val); m != nil {
							v, err := strconv.ParseFloat(m[1], 64)
							if err != nil {
								panic(err)
							}
							p.indent = v
							if strings.EqualFold(m[2], "in") {
								p.indent *= 72
							}
						}
					}
				}
				ps = append(ps, p)
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	var out []Item
	var rows [][]string
	header := ""
	active, age := false, 0
	flush := func() {
		if len(rows) >= 2 {
			g := &Grid{Rows: append([][]string{{"Common Stock", "Common Stock", "Common Stock"}, {"Name and Address of Beneficial Owner", "Number of Shares Beneficially Owned", "Percent of Class"}}, rows...), Pos: firstPos + len(out)}
			out = append(out, Item{Kind: "table", Grid: g, Text: header, Pos: g.Pos})
		}
		rows = nil
	}
	for i := 0; i < len(ps); i++ {
		p := ps[i]
		if isHeadingChunk(p.text) {
			flush()
			header = p.text
			active = true
			age = 0
			continue
		}
		if !active {
			continue
		}
		age++
		if age > 100 {
			flush()
			active = false
			continue
		}
		if len(rows) == 0 {
			header += " " + p.text
		}
		if i+2 >= len(ps) || !p.overlap || p.indent != 0 || !hasWords(p.text, 1) {
			continue
		}
		sh, pc := ps[i+1], ps[i+2]
		if !sh.overlap || sh.indent <= 0 || pc.indent <= sh.indent {
			continue
		}
		v, ok := ParseShares(sh.text)
		_, _, _, pctish := ParsePercent(pc.text)
		if !ok || v < 100 || !pctish || !(strings.Contains(pc.text, "%") || reStar.MatchString(pc.text) || reLessThan.MatchString(pc.text)) {
			continue
		}
		if !reHdrNameCol.MatchString(header) || !strings.Contains(strings.ToLower(header), "beneficially owned") || !strings.Contains(strings.ToLower(header), "common stock") || !reHdrPct.MatchString(header) {
			continue
		}
		name := p.text
		if grp, _ := isGroupRow(name); grp {
			for back := i - 1; back >= 0 && back >= i-2 && ps[back].indent == 0; back-- {
				if previous, _ := isGroupRow(ps[back].text); !previous {
					break
				}
				name = ps[back].text + " " + name
			}
		}
		rows = append(rows, []string{name, sh.text, pc.text})
		i += 2
	}
	flush()
	return out
}

// A headed ownership table can be serialized as one separate HTML table per
// holding. Join only three-column, complete share/percent fragments following
// an explicit standalone header; retain the normal multi-row ownership guards.
func fragmentedOwnershipItems(items []Item, firstPos int) []Item {
	var out []Item
	var header string
	var rows [][]string
	seen := map[string]bool{}
	flush := func() {
		group := false
		if len(rows) == 1 {
			group, _ = isStrongGroupRow(rows[0][0])
		}
		if header != "" && (len(rows) >= 2 || group) {
			g := &Grid{Rows: append([][]string{{"Name of Beneficial Owner", "Amount and Nature of Beneficial Ownership", "Percent of Class"}}, rows...), Pos: firstPos + len(out)}
			out = append(out, Item{Kind: "table", Grid: g, Text: header, Pos: g.Pos})
		}
		header = ""
		rows = nil
		seen = map[string]bool{}
	}
	for _, it := range items {
		if it.Kind != "table" {
			continue
		}
		c := compactColumns(it.Grid, true)
		ndata := 0
		for _, r := range c.rows {
			if rowIsData(r) {
				ndata++
			}
		}
		if ndata == 0 && reHdrNameCol.MatchString(it.Text) && reOwnCue.MatchString(it.Text) && reHdrPct.MatchString(it.Text) && !reOptDetailCue.MatchString(it.Text) && !reCompCue.MatchString(it.Text) {
			flush()
			header = it.Text
			continue
		}
		if header == "" {
			continue
		}
		if ndata != 1 {
			flush()
			continue
		}
		matched := false
		for i, r := range c.rows {
			if len(r) != 3 || !hasWords(r[0], 1) {
				continue
			}
			if _, ok := ParseShares(r[1]); !ok {
				continue
			}
			_, _, _, pctish := ParsePercent(r[2])
			if !pctish || !(strings.Contains(r[2], "%") || reStar.MatchString(r[2]) || reLessThan.MatchString(r[2])) {
				continue
			}
			name := r[0]
			if i+1 < len(c.rows) && len(c.rows[i+1]) == 3 && c.rows[i+1][1] == "" && c.rows[i+1][2] == "" {
				if grp, _ := isStrongGroupRow(name + " " + c.rows[i+1][0]); grp {
					name += " " + c.rows[i+1][0]
				}
			}
			fragment := []string{name, r[1], r[2]}
			sig := strings.Join(fragment, "\x00")
			if !seen[sig] {
				rows = append(rows, fragment)
				seen[sig] = true
			}
			matched = true
			break
		}
		if !matched {
			flush()
		}
	}
	flush()
	return out
}
