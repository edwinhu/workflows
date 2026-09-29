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
//
// Copied from parse_def14a_own/parse_def14a_own_go/grid.go. One rename:
// `reWS` -> `reWSRun`, because helpers_test.go already declares `reWS` in this
// package and the test files are not editable from here. Nothing else differs.

var (
	reWSRun  = regexp.MustCompile(`\s+`)
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
	return strings.TrimSpace(reWSRun.ReplaceAllString(s, " "))
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
				if len(g.Rows) >= 2 && g.NCol() >= 2 {
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
