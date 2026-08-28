package main

import (
	"strings"
	"testing"
)

// EDGAR hard-wraps a dissemination file at 1023 columns, and the wrap is blind
// to what it cuts: it splits character entities and element tags in half. In
// the real filing 000003/34066/0000932471-10-002674.txt, 9,051 of 30,168 lines
// are exactly 1023 characters, and among them are lines ending in "&" whose
// successor begins "#160;", and lines ending mid-attribute whose successor
// begins "'font-size:12.0pt;'>".
//
// stripHTML removes markup and decodes entities without ever rejoining those
// lines (html.go: removeMarkup -> decodeEntities -> collapseSpaces). So:
//
//   - decodeEntities' search for the closing ';' crosses the newline, resolves
//     a body of "\n#160", fails to match, and falls through to the literal-'&'
//     branch -- emitting a bare "&" and leaving "#160;" behind as plain text.
//   - removeMarkup sees "<font ... style=" with no closing '>' on that line, so
//     the tag's tail leaks out as text on the next line.
//
// Both corrupt the row's token stream, which is how the literal strings "&" and
// "#160;" end up in the how_voted column: 13,298 vanguard rows carry "#160;" as
// their vote. See docs/investigations/2026-08-27_parse-npx-vs-iss.md.
//
// These tests assert the OUTCOME -- markup and entities resolve correctly
// across a wrap -- and deliberately do not prescribe the mechanism. Joining on
// a 1023-column boundary, or joining only when the newline falls strictly
// inside a "&...;" or "<...>" window, both satisfy them.

// wrapAt1023 reproduces EDGAR's hard wrap: it cuts s into physical lines of
// exactly 1023 characters, with no regard for token boundaries.
func wrapAt1023(s string) string {
	const w = 1023
	var b strings.Builder
	for len(s) > w {
		b.WriteString(s[:w])
		b.WriteByte('\n')
		s = s[w:]
	}
	b.WriteString(s)
	return b.String()
}

func TestLineWrapEntity(t *testing.T) {
	// A row whose &#160; padding straddles the 1023-column cut.
	pad := strings.Repeat("&#160;", 200)
	row := "<p><font face=Arial>ELECTION OF DIRECTOR: JANE DOE</font>" + pad +
		"<font face=Arial>ISSUER</font>" + pad + "<font face=Arial>YES</font>" +
		pad + "<font face=Arial>FOR</font>" + pad + "<font face=Arial>FOR</font></p>"
	wrapped := wrapAt1023(row)
	if !strings.Contains(wrapped, "\n") {
		t.Fatalf("fixture did not actually wrap; it must exceed 1023 characters")
	}

	got := string(stripHTML([]byte(wrapped)))

	if strings.Contains(got, "#160;") {
		t.Errorf("a literal %q survived stripHTML; the entity was split by the wrap"+
			" and never rejoined\ngot: %q", "#160;", got)
	}
	if strings.Contains(got, "&") {
		t.Errorf("a literal %q survived stripHTML; decodeEntities fell through to its"+
			" unresolved-entity branch\ngot: %q", "&", got)
	}
	// The five cells belong to ONE logical row. Whatever the mechanism, they
	// must not be split across output lines by an artefact of the wrap.
	for _, line := range strings.Split(got, "\n") {
		if strings.Contains(line, "JANE DOE") {
			for _, cell := range []string{"ISSUER", "YES", "FOR"} {
				if !strings.Contains(line, cell) {
					t.Errorf("the row carrying JANE DOE lost cell %q; the wrap split one"+
						" logical row across physical lines\nline: %q", cell, line)
				}
			}
			return
		}
	}
	t.Errorf("no output line carried JANE DOE at all\ngot: %q", got)
}

func TestLineWrapTag(t *testing.T) {
	// A row whose <font ...> start tag straddles the cut, which is the second
	// thing EDGAR's wrap cuts in half.
	filler := strings.Repeat("X", 1000)
	row := "<p><font face=Arial lang=EN-US style='font-size:12.0pt;'>" + filler +
		"</font><font face=Arial lang=EN-US style='font-size:8.0pt;'>VOTECELL</font></p>"
	wrapped := wrapAt1023(row)
	if !strings.Contains(wrapped, "\n") {
		t.Fatalf("fixture did not actually wrap")
	}

	got := string(stripHTML([]byte(wrapped)))

	for _, leak := range []string{"font-size", "face=Arial", "lang=EN-US", "<font", "</font"} {
		if strings.Contains(got, leak) {
			t.Errorf("markup %q leaked into the text; a tag split by the wrap was not"+
				" recognised as a tag\ngot: %q", leak, got)
		}
	}
	if !strings.Contains(got, "VOTECELL") {
		t.Errorf("the cell after the split tag was lost\ngot: %q", got)
	}
}

// TestLineWrapRealFiling is the same defect on real bytes: testdata/vanguard/
// V3.txt is a verbatim excerpt of 000003/34066/0000932471-10-002674.txt, whose
// lines are EDGAR-wrapped at 1023. Three complete proposal rows are in it, and
// each must come out of stripHTML whole.
func TestLineWrapRealFiling(t *testing.T) {
	raw := loadVanguardFixture(t, "V3.txt")
	got := string(stripHTML(raw))

	if strings.Contains(got, "#160;") {
		t.Errorf("a literal %q survived stripHTML on a real filing", "#160;")
	}
	if strings.Contains(got, "font-size") {
		t.Errorf("markup leaked into the text on a real filing")
	}

	for _, nominee := range []string{"KATHLEEN A. COTE", "DAVID H.Y. HO", "ROBERT Y.L. MAO"} {
		found := false
		for _, line := range strings.Split(got, "\n") {
			if !strings.Contains(line, nominee) {
				continue
			}
			found = true
			// Every one of these three rows reads "... ISSUER YES FOR FOR".
			fields := strings.Fields(line)
			if n := len(fields); n < 4 ||
				fields[n-1] != "FOR" || fields[n-2] != "FOR" ||
				fields[n-3] != "YES" || fields[n-4] != "ISSUER" {
				t.Errorf("row for %s does not end in the four cells"+
					" ISSUER YES FOR FOR\nline: %q", nominee, line)
			}
			break
		}
		if !found {
			t.Errorf("no output line carried nominee %q", nominee)
		}
	}
}
